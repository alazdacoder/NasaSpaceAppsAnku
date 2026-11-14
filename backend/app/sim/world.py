"""The onboard system: mission clock, simulator, adapters, rules, tasks, protocols,
live workouts and the outbox to the ground. Everything the crew app shows comes from
here and the onboard database - never from the ground."""
from __future__ import annotations

import json
import math
import time
from typing import Any, Callable

from ..adapters.manual import CSVImportAdapter, ManualAdapter
from ..adapters.simulated import all_sim_adapters
from ..db import DB, dumps
from ..engine.response import protocol_response
from ..engine.rules import LEVELS, evaluate_crew
from ..engine.stats import ewma
from ..link.groundlink import GroundLink
from .model import CrewState, DayInputs, caox_supersaturation, planned_sessions, rng_for, simulate_day, water_target

DEVICE_LABEL = {"ared": "ARED", "t2": "T2 treadmill", "cevis": "CEVIS cycle"}


class World:
    def __init__(self, cfg: dict, db: DB, seed: int | None = None, real_clock: Callable[[], float] = time.time):
        self.cfg = cfg
        self.db = db
        self.real = real_clock
        sim = cfg["simulation"]
        self.seed = int(sim["seed"] if seed is None else seed)
        self.crew: list[dict] = cfg["crew"]
        self.crew_ids = [c["id"] for c in self.crew]
        self.crew_idx = {c["id"]: i for i, c in enumerate(self.crew)}
        self.profiles = {c["id"]: c for c in self.crew}
        self.state = {cid: CrewState() for cid in self.crew_ids}
        self.truth: dict[tuple[str, int], dict] = {}
        self.adapters = all_sim_adapters() + [ManualAdapter(), CSVImportAdapter()]
        self.adapter_by_id = {a.id: a for a in self.adapters}
        self.link = GroundLink(db, cfg, real_clock)
        self.link.on_profile_change.append(self._profile_changed)
        self.autopilot = {cid: True for cid in self.crew_ids}
        self.day_seconds = float(sim["day_seconds_default"])
        self.first_day = -int(sim["preflight_days"])
        self.last_day = int(sim["mission_days"]) - 1
        self.mission_t = float(self.first_day)
        self._last_real = self.real()
        self._last_snapshot = 0.0
        self.version = 0
        self._eval_cache: dict[str, tuple[tuple, dict]] = {}
        self.live: dict[str, dict] = {}
        self.external_hr: dict[str, tuple[float, float]] = {}
        self._prev_alerts: dict[str, list[dict]] = {}

    # ------------------------------------------------------------------ clock
    @property
    def today(self) -> int:
        return int(math.floor(self.mission_t))

    @property
    def last_closed_day(self) -> int:
        return self.today - 1

    def bootstrap(self, start_day: int | None = None) -> None:
        sim = self.cfg["simulation"]
        start = int(sim["start_day"] if start_day is None else start_day)
        for e in self.cfg["scripted_events"]:
            s = e.get("start", e.get("day"))
            self.db.execute("INSERT INTO events(crew_id, kind, start_day, end_day, params, origin, created_real) VALUES (?,?,?,?,?,?,?)",
                            (e["crew"], e["kind"], s, e.get("end", s), dumps(self._event_params(e)), "scripted", self.real()))
        self.mission_t = float(self.first_day)
        self._begin_day(self.first_day, quiet=True)
        while self.today < start:
            d = self.today
            self._close_day(d)
            self.mission_t = float(d + 1)
            self._begin_day(d + 1, quiet=d + 1 < start)
        self.mission_t = start + sim["start_hour"] / 24.0
        self._last_real = self.real()
        self.send_snapshots()
        self.link.deliver_all_now()

    def _event_params(self, e: dict) -> dict:
        inj = self.cfg["injectable_events"].get(e["kind"], {})
        params = {k: v for k, v in inj.items() if k not in ("label", "days")}
        params.update({k: v for k, v in e.items() if k not in ("crew", "kind", "start", "end", "day")})
        return params

    def tick(self) -> None:
        now = self.real()
        dt = max(0.0, now - self._last_real)
        self._last_real = now
        if self.day_seconds > 0:
            self.advance(dt / self.day_seconds)
        self._update_live(now)
        if now - self._last_snapshot >= self.cfg["link"]["snapshot_every_s"]:
            self.send_snapshots()
        self.link.pump()

    def advance(self, days: float) -> None:
        end = self.last_day + 1 - 1e-6
        target = min(self.mission_t + days, end)
        while math.floor(target) > self.today:
            d = self.today
            self._close_day(d)
            self.mission_t = float(d + 1)
            self._begin_day(d + 1)
        self.mission_t = max(self.mission_t, target)
        if self.mission_t >= end:
            self.day_seconds = 0.0

    def set_speed(self, day_seconds: float) -> None:
        self.day_seconds = max(0.0, float(day_seconds))
        self._last_real = self.real()

    # ------------------------------------------------------------ world API
    def day_truth(self, crew_id: str, day: int) -> dict | None:
        return self.truth.get((crew_id, day))

    def last_truth(self, crew_id: str) -> dict | None:
        for d in range(self.last_closed_day, self.first_day - 1, -1):
            t = self.truth.get((crew_id, d))
            if t:
                return t
        return None

    def live_workout(self, crew_id: str) -> dict | None:
        return self.live.get(crew_id)

    # ------------------------------------------------------------- day cycle
    def _active_events(self, crew_id: str, day: int) -> list[dict]:
        rows = self.db.all("SELECT * FROM events WHERE crew_id=? AND start_day<=? AND end_day>=? AND kind!='protocol_start'",
                           (crew_id, day, day))
        return [{"kind": r["kind"], "params": json.loads(r["params"] or "{}")} for r in rows]

    def active_protocols(self, crew_id: str, day: int) -> list[dict]:
        return self.db.all("SELECT * FROM protocols WHERE crew_id=? AND start_day<=? AND (end_day IS NULL OR end_day>=?) "
                           "AND status='active' ORDER BY id", (crew_id, day, day))

    def _inputs(self, crew_id: str, day: int) -> DayInputs:
        tasks = {t["task_id"]: t for t in self.db.all("SELECT * FROM tasks WHERE crew_id=? AND day=?", (crew_id, day))}
        user_w = []
        for w in self.db.all("SELECT * FROM workouts WHERE crew_id=? AND day=? AND source='user'", (crew_id, day)):
            user_w.append({"device": w["device"], "minutes": w["minutes"], "avg_hr": w["avg_hr"], "max_hr": w["max_hr"],
                           "details": json.loads(w["details"] or "{}")})
        done_slots = set()
        for slot in ("ared", "cardio"):
            t = tasks.get(f"workout:{slot}")
            if t and t["status"] == "done" and json.loads(t["payload"] or "{}").get("via") != "live":
                done_slots.add(slot)
        water_extra, food, feeling, sup_manual = 0.0, [], None, set()
        for e in self.db.all("SELECT kind, payload FROM manual_entries WHERE crew_id=? AND day=? ORDER BY id", (crew_id, day)):
            p = json.loads(e["payload"])
            if e["kind"] == "water":
                water_extra += float(p.get("liters", 0))
            elif e["kind"] == "food":
                food.append(p)
            elif e["kind"] == "feeling":
                feeling = float(p["value"])
            elif e["kind"] == "supplement" and p.get("protocol_id"):
                sup_manual.add(int(p["protocol_id"]))
        protocols = [{"id": p["id"], "type": p["type"], "start_day": p["start_day"]} for p in self.active_protocols(crew_id, day)]
        confirmed = {p["id"] for p in protocols
                     if tasks.get(f"supplement:{p['id']}", {}).get("status") == "done" or p["id"] in sup_manual}
        return DayInputs(
            autopilot=self.autopilot[crew_id], user_workouts=user_w, workout_tasks_done=done_slots,
            water_task_done=tasks.get("water", {}).get("status") == "done", water_extra_l=water_extra,
            food_entries=food, feeling=feeling, protocols=protocols, doses_confirmed=confirmed,
            events=self._active_events(crew_id, day), profile=self.link.profile)

    def _close_day(self, day: int) -> None:
        for cid in self.crew_ids:
            inp = self._inputs(cid, day)
            truth = simulate_day(self.cfg, self.seed, self.crew_idx[cid], self.profiles[cid], self.state[cid], day, inp)
            self.truth[(cid, day)] = truth
            all_samples: dict[str, float] = {}
            for ad in self.adapters:
                vals = ad.read_day(cid, day, self)
                if vals:
                    self.db.put_samples(cid, day, vals, ad.id)
                    all_samples.update(vals)
            derived = {"ex_total_min": truth["ex_min"], "ex_week_min": truth["ex_week_min"],
                       "ared_week_min": truth["ared_week_min"]}
            if all(k in all_samples for k in ("u_calcium", "u_oxalate", "u_citrate", "u_ph", "u_volume")):
                derived["caox_ss"] = caox_supersaturation(all_samples["u_calcium"], all_samples["u_oxalate"],
                                                          all_samples["u_citrate"], all_samples["u_ph"], all_samples["u_volume"])
            self.db.put_samples(cid, day, derived, "derived")
            all_samples.update(derived)
            now = self.real()
            self.db.executemany(
                "INSERT INTO workouts(crew_id, day, device, minutes, avg_hr, max_hr, details, source, created_real) VALUES (?,?,?,?,?,?,?,?,?)",
                [(cid, day, s["device"], s["minutes"], s["avg_hr"], s["max_hr"], dumps(s["details"]), s["source"], now)
                 for s in truth["sessions"] if s["source"] != "user"])
            self.db.executemany("INSERT OR REPLACE INTO doses(crew_id, day, protocol_id, taken, source) VALUES (?,?,?,?,?)",
                                [(cid, day, pid, int(d["taken"]), d["source"]) for pid, d in truth["doses"].items()])
            self._finalize_tasks(cid, day, truth)
            self.link.enqueue(cid, "daily", {"day": day, "samples": all_samples}, day + 1.0)
        self.version += 1

    def _finalize_tasks(self, cid: str, day: int, truth: dict) -> None:
        for t in self.db.all("SELECT * FROM tasks WHERE crew_id=? AND day=? AND status='pending'", (cid, day)):
            tid = t["task_id"]
            status = "missed"
            if tid.startswith("workout:"):
                slot = tid.split(":")[1]
                devs = {"ared"} if slot == "ared" else {"t2", "cevis"}
                if any(s["device"] in devs for s in truth["sessions"]):
                    status = "auto"
            elif tid == "water":
                status = "auto" if truth["water_l"] >= truth["water_target_l"] - 0.05 else "missed"
            elif tid.startswith("supplement:"):
                pid = int(tid.split(":")[1])
                status = "auto" if truth["doses"].get(pid, {}).get("taken") else "missed"
            elif tid.startswith("supplement_start:"):
                status = "expired"
            self.db.execute("UPDATE tasks SET status=? WHERE crew_id=? AND day=? AND task_id=?", (status, cid, day, tid))

    def _begin_day(self, day: int, quiet: bool = False) -> None:
        for e in self.db.all("SELECT * FROM events WHERE kind='protocol_start' AND start_day=?", (day,)):
            params = json.loads(e["params"] or "{}")
            self.start_protocol(e["crew_id"], params.get("protocol", "potassium_citrate"), day,
                                started_by="scripted", reason="Scripted demo event (poor responder)")
        for cid in self.crew_ids:
            prev = {a["id"] for a in self._prev_alerts.get(cid, [])}
            ev = self.evaluation(cid)
            alerts = ev["alerts"]
            for a in alerts:
                if a["id"] not in prev and day >= 0:
                    self.log(cid, "alert", a["level"], f"{a['title']}: {a['reason']}", mission_t=float(day), send=not quiet)
            self._prev_alerts[cid] = alerts
            self._make_tasks(cid, day, ev)
        if not quiet:
            self.send_snapshots()

    def _make_tasks(self, cid: str, day: int, ev: dict) -> None:
        rows = []
        for plan in planned_sessions(self.cfg, day):
            dev = plan["device"]
            if dev == "ared":
                detail = ", ".join(self.cfg["prescription"]["ared_exercises"])
            elif dev == "t2":
                detail = f"Run at about {self.profiles[cid]['t2_speed_kmh'] * self.state[cid].fitness:.1f} km/h"
            else:
                detail = f"Cycle at about {round(self.profiles[cid]['cevis_watts'] * self.state[cid].fitness)} W"
            rows.append((f"workout:{plan['slot']}", "workout", f"{DEVICE_LABEL[dev]} - {plan['minutes']} min", detail,
                         {"device": dev, "minutes": plan["minutes"], "slot": plan["slot"]}))
        planned_min = sum(p["minutes"] for p in planned_sessions(self.cfg, day))
        tgt = water_target(self.cfg, planned_min)
        rows.append(("water", "water", f"Drink {tgt:.1f} L of water",
                     "Target for today's exercise. Keeps urine above 2.5 L/day.", {"target_l": tgt}))
        active = self.active_protocols(cid, day)
        for p in active:
            pdef = self.cfg["protocols"][p["type"]]
            rows.append((f"supplement:{p['id']}", "supplement", pdef["label"], pdef["dose_text"],
                         {"protocol_id": p["id"], "type": p["type"]}))
        active_types = {p["type"] for p in active}
        for a in ev["alerts"]:
            if any(r["id"] == "start_k_citrate" for r in a["recs"]) and "potassium_citrate" not in active_types:
                pdef = self.cfg["protocols"]["potassium_citrate"]
                rows.append(("supplement_start:potassium_citrate", "supplement_start", f"Start {pdef['label'].lower()}",
                             pdef["dose_text"], {"type": "potassium_citrate", "alert_id": a["id"], "alert_title": a["title"],
                                                 "reason": a["reason"], "source": pdef["source"], "verified": pdef["verified"]}))
                break
        self.db.executemany(
            "INSERT OR IGNORE INTO tasks(crew_id, day, task_id, kind, title, detail, status, payload) VALUES (?,?,?,?,?,?, 'pending', ?)",
            [(cid, day, tid, kind, title, detail, dumps(payload)) for tid, kind, title, detail, payload in rows])

    # ----------------------------------------------------------- protocols
    def start_protocol(self, cid: str, ptype: str, day: int, started_by: str, reason: str) -> int:
        existing = [p for p in self.active_protocols(cid, day) if p["type"] == ptype]
        if existing:
            return existing[0]["id"]
        cur = self.db.execute("INSERT INTO protocols(crew_id, type, start_day, status, started_by, reason) VALUES (?,?,?, 'active', ?, ?)",
                              (cid, ptype, day, started_by, reason))
        pid = cur.lastrowid
        pdef = self.cfg["protocols"][ptype]
        self.log(cid, "protocol", "info", f"Started {pdef['label']} ({pdef['dose_text']}) on day {day}. {reason}",
                 mission_t=float(day))
        self.version += 1
        return pid

    def protocol_results(self, cid: str, series: dict | None = None) -> list[dict]:
        series = series if series is not None else self.db.series(cid)
        today = self.last_closed_day
        out = []
        for p in self.db.all("SELECT * FROM protocols WHERE crew_id=? ORDER BY id", (cid,)):
            pdef = self.cfg["protocols"][p["type"]]
            sm = {}
            for t in pdef["targets"]:
                days, vals = series.get(t["metric"], ([], []))
                alpha = self.cfg["metrics"][t["metric"]].get("ewma_alpha", self.cfg["defaults"]["ewma_alpha"])
                sm[t["metric"]] = {"days": days, "ewma": ewma(vals, alpha) if vals else []}
            res = protocol_response(sm, pdef["targets"], p["start_day"], today, pdef.get("stop_at_target", True),
                                    pdef.get("days_to_target_fraction", 0.9))
            doses = self.db.one("SELECT COUNT(*) n, SUM(taken) t FROM doses WHERE protocol_id=?", (p["id"],))
            res.update({"protocol_id": p["id"], "type": p["type"], "label": pdef["label"], "dose_text": pdef["dose_text"],
                        "start_day": p["start_day"], "status": p["status"], "started_by": p["started_by"],
                        "reason": p["reason"], "days_since_start": max(0, today - p["start_day"] + 1),
                        "adherence": (doses["t"] or 0) / doses["n"] if doses and doses["n"] else None,
                        "source": pdef["source"], "verified": pdef["verified"]})
            out.append(res)
        return out

    # ------------------------------------------------------------ evaluation
    def evaluation(self, cid: str) -> dict:
        key = (self.version, self.last_closed_day)
        cached = self._eval_cache.get(cid)
        if cached and cached[0] == key:
            return cached[1]
        series = self.db.series(cid, max_day=self.last_closed_day)
        presults = self.protocol_results(cid, series)
        ev = evaluate_crew(self.cfg, series, self.last_closed_day, presults)
        ev["protocols"] = presults
        self._eval_cache[cid] = (key, ev)
        return ev

    # ------------------------------------------------------------------ tasks
    def tasks(self, cid: str, day: int | None = None) -> list[dict]:
        day = self.today if day is None else day
        rows = self.db.all("SELECT * FROM tasks WHERE crew_id=? AND day=? ORDER BY rowid", (cid, day))
        for r in rows:
            r["payload"] = json.loads(r["payload"] or "{}")
        order = {"supplement_start": 0, "workout": 1, "supplement": 2, "water": 3}
        rows.sort(key=lambda r: order.get(r["kind"], 9))
        return rows

    def confirm_task(self, cid: str, task_id: str, via: str = "confirm") -> dict:
        day = self.today
        t = self.db.one("SELECT * FROM tasks WHERE crew_id=? AND day=? AND task_id=?", (cid, day, task_id))
        if t is None:
            raise KeyError(task_id)
        if t["status"] == "done":
            return t
        payload = json.loads(t["payload"] or "{}")
        payload["via"] = via
        if t["kind"] == "supplement_start":
            pid = self.start_protocol(cid, payload["type"], day, started_by="crew",
                                      reason=f"Accepted from alert: {payload.get('alert_title', '')}")
            pdef = self.cfg["protocols"][payload["type"]]
            self.db.execute("INSERT OR IGNORE INTO tasks(crew_id, day, task_id, kind, title, detail, status, payload, confirmed_mission_t) "
                            "VALUES (?,?,?,?,?,?, 'done', ?, ?)",
                            (cid, day, f"supplement:{pid}", "supplement", pdef["label"], pdef["dose_text"],
                             dumps({"protocol_id": pid, "type": payload["type"], "via": via}), self.mission_t))
            payload["protocol_id"] = pid
        self.db.execute("UPDATE tasks SET status='done', confirmed_mission_t=?, payload=? WHERE crew_id=? AND day=? AND task_id=?",
                        (self.mission_t, dumps(payload), cid, day, task_id))
        self.log(cid, "task", "info", f"Confirmed: {t['title']}")
        self.send_snapshots([cid])
        return self.db.one("SELECT * FROM tasks WHERE crew_id=? AND day=? AND task_id=?", (cid, day, task_id))

    # ---------------------------------------------------------- manual entry
    def add_manual(self, cid: str, kind: str, payload: dict) -> dict:
        if kind == "food":
            item = next((i for i in self.cfg["food_catalog"]["items"] if i["id"] == payload.get("item")), None)
            if item is None:
                raise KeyError(payload.get("item"))
            payload = {**{k: v for k, v in item.items()}, **payload}
        elif kind == "water":
            payload = {"liters": float(payload["liters"])}
            if not 0 < payload["liters"] <= 2:
                raise ValueError("liters must be between 0 and 2")
        elif kind == "feeling":
            v = int(payload["value"])
            if not 1 <= v <= 5:
                raise ValueError("feeling must be 1-5")
            payload = {"value": v}
        elif kind == "supplement":
            payload = {"protocol_id": int(payload["protocol_id"])}
        else:
            raise KeyError(kind)
        self.db.execute("INSERT INTO manual_entries(crew_id, day, kind, payload, created_real, mission_t) VALUES (?,?,?,?,?,?)",
                        (cid, self.today, kind, dumps(payload), self.real(), self.mission_t))
        if kind == "supplement":
            self.db.execute("UPDATE tasks SET status='done', confirmed_mission_t=? WHERE crew_id=? AND day=? AND task_id=?",
                            (self.mission_t, cid, self.today, f"supplement:{payload['protocol_id']}"))
        return {"kind": kind, "payload": payload, "day": self.today}

    def manual_today(self, cid: str) -> list[dict]:
        rows = self.db.all("SELECT id, kind, payload, mission_t FROM manual_entries WHERE crew_id=? AND day=? ORDER BY id",
                           (cid, self.today))
        for r in rows:
            r["payload"] = json.loads(r["payload"])
        return rows

    def import_csv(self, text: str) -> dict:
        ad: CSVImportAdapter = self.adapter_by_id["csv"]  # type: ignore[assignment]
        rows, errors = ad.parse(text, set(self.cfg["metrics"]), set(self.crew_ids))
        rows = [r for r in rows if r[1] <= self.last_closed_day]
        self.db.executemany("INSERT OR REPLACE INTO samples(crew_id, day, metric, value, source) VALUES (?,?,?,?, 'csv')", rows)
        ad.imported_rows += len(rows)
        for r in rows:
            ad.last_sync[r[0]] = self.mission_t
        if rows:
            self.version += 1
        return {"imported": len(rows), "errors": errors[:20]}

    # --------------------------------------------------------------- events
    def inject_event(self, cid: str, kind: str, days: int | None = None) -> dict:
        inj = self.cfg["injectable_events"].get(kind)
        if inj is None:
            raise KeyError(kind)
        n = int(days or inj["days"])
        start = self.today
        params = {k: v for k, v in inj.items() if k not in ("label", "days")}
        self.db.execute("INSERT INTO events(crew_id, kind, start_day, end_day, params, origin, created_real) VALUES (?,?,?,?,?,?,?)",
                        (cid, kind, start, start + n - 1, dumps(params), "injected", self.real()))
        self.log(cid, "event", "warn", f"Injected event: {inj['label']} for {n} day(s) from day {start}")
        return {"crew_id": cid, "kind": kind, "start_day": start, "end_day": start + n - 1}

    def events_for(self, cid: str | None = None) -> list[dict]:
        sql = "SELECT * FROM events"
        params: tuple = ()
        if cid:
            sql += " WHERE crew_id=?"
            params = (cid,)
        rows = self.db.all(sql + " ORDER BY start_day", params)
        for r in rows:
            r["params"] = json.loads(r["params"] or "{}")
            r["label"] = self.cfg["injectable_events"].get(r["kind"], {}).get("label", r["kind"].replace("_", " "))
        return rows

    def log(self, cid: str | None, kind: str, level: str, text: str, mission_t: float | None = None, send: bool = True) -> None:
        mt = self.mission_t if mission_t is None else mission_t
        self.db.execute("INSERT INTO event_log(crew_id, mission_t, created_real, kind, level, text) VALUES (?,?,?,?,?,?)",
                        (cid, mt, self.real(), kind, level, text))
        if send:
            self.link.enqueue(cid, "event", {"kind": kind, "level": level, "text": text}, mt)

    def _profile_changed(self, profile: str) -> None:
        self.log(None, "link", "info", f"Mission profile changed to {self.cfg['link']['profiles'][profile]['label']}")

    # -------------------------------------------------------------- snapshots
    def snapshot(self, cid: str) -> dict:
        ev = self.evaluation(cid)
        live = {}
        for aid in ("biomonitor", "tmini", "co2"):
            live.update(self.adapter_by_id[aid].live(cid, self.mission_t, self))
        return {
            "crew_id": cid, "mission_t": self.mission_t, "today": self.today, "overall": ev["overall"],
            "alerts": [{k: a[k] for k in ("id", "title", "level", "reason", "kind")} | {"recs": [r["text"] for r in a["recs"]]}
                       for a in ev["alerts"]],
            "protocols": [{k: p[k] for k in ("protocol_id", "label", "score", "start_day", "days_since_start",
                                              "days_to_target_left", "adherence", "started_by")}
                          | {"targets": [{k: t[k] for k in ("metric", "label", "start", "target", "current", "progress")}
                                         for t in p["targets"]]} for p in ev["protocols"]],
            "tasks": [{"task_id": t["task_id"], "title": t["title"], "status": t["status"]} for t in self.tasks(cid)],
            "live": live, "workout_active": cid in self.live,
            "metrics": {m: {"value": e["value"], "ewma": e["ewma"], "z": e["z"], "status": e["status"], "day": e["day"]}
                        for m, e in ev["metrics"].items()},
        }

    def send_snapshots(self, crew_ids: list[str] | None = None) -> None:
        for cid in crew_ids or self.crew_ids:
            self.link.enqueue(cid, "state", self.snapshot(cid), self.mission_t)
        if crew_ids is None:
            self._last_snapshot = self.real()

    # ---------------------------------------------------------- live workout
    def start_workout(self, cid: str, device: str, settings: dict) -> dict:
        if device not in ("ared", "t2", "cevis"):
            raise ValueError("device must be ared, t2 or cevis")
        prof = self.profiles[cid]
        st = self.state[cid]
        defaults = {
            "ared": {"exercise": "squat", "load_kg": round(prof["ared_squat_kg"] * st.strength), "sets": 3, "reps": 10},
            "t2": {"speed_kmh": round(prof["t2_speed_kmh"] * st.fitness, 1), "harness_kg": round(prof["mass_kg"] * 0.7)},
            "cevis": {"watts": round(prof["cevis_watts"] * st.fitness)},
        }[device]
        now = self.real()
        hr0 = float(self.last_truth(cid)["vitals"]["hr_rest"]) + 10 if self.last_truth(cid) else 70.0
        merged = {**defaults, **{k: v for k, v in (settings or {}).items() if v is not None}}
        self._clamp(merged)
        sess = {"crew_id": cid, "device": device, "settings": merged, "start_real": now,
                "last_real": now, "elapsed_s": 0.0, "hr": hr0, "samples": [], "sets_done": [], "day": self.today,
                "scale": float(self.cfg["simulation"]["workout_time_scale"]), "hr_source": "simulated shirt"}
        self.live[cid] = sess
        self.log(cid, "workout", "info", f"Started live {DEVICE_LABEL[device]} session")
        return self.workout_view(cid)

    def update_workout(self, cid: str, settings: dict | None = None, log_set: bool = False) -> dict:
        sess = self.live.get(cid)
        if not sess:
            raise KeyError("no active workout")
        if settings:
            sess["settings"].update({k: v for k, v in settings.items() if v is not None})
            self._clamp(sess["settings"])
        if log_set and sess["device"] == "ared":
            s = sess["settings"]
            sess["sets_done"].append({"exercise": s["exercise"], "load_kg": s["load_kg"], "reps": int(s.get("reps", 10))})
        return self.workout_view(cid)

    def _clamp(self, s: dict) -> None:
        """Keep settings inside machine limits (ARED 272 kg, T2 19.3 km/h)."""
        lim = self.cfg["limits"]
        if "load_kg" in s:
            s["load_kg"] = max(0.0, min(lim["ared_peak_load_kg"], float(s["load_kg"])))
        if "speed_kmh" in s:
            s["speed_kmh"] = max(0.0, min(lim["t2_peak_speed_kmh"], float(s["speed_kmh"])))
        if "harness_kg" in s:
            s["harness_kg"] = max(0.0, min(150.0, float(s["harness_kg"])))
        if "watts" in s:
            s["watts"] = max(0.0, min(self.cfg["cevis_limits"]["max_watts"], float(s["watts"])))
        if "reps" in s:
            s["reps"] = max(1, min(30, int(s["reps"])))

    def _target_hr(self, sess: dict) -> float:
        prof = self.profiles[sess["crew_id"]]
        rest = prof["hr_rest"]
        s = sess["settings"]
        m = self.cfg["model"]
        if sess["device"] == "ared":
            t = rest + 28 + 0.14 * float(s.get("load_kg", 100))
        elif sess["device"] == "t2":
            t = rest + 6.0 * float(s.get("speed_kmh", 9)) + 0.05 * float(s.get("harness_kg", 50))
        else:
            t = rest + m["hr_per_watt"] * float(s.get("watts", 150))
        return min(t, rest + m["hr_max_offset"])

    def _update_live(self, now: float) -> None:
        for cid, sess in self.live.items():
            dt_real = now - sess["last_real"]
            if dt_real <= 0:
                continue
            sess["last_real"] = now
            dt = dt_real * sess["scale"]
            sess["elapsed_s"] += dt
            ext = self.external_hr.get(cid)
            if ext and now - ext[1] < 5:
                sess["hr"] = ext[0]
                sess["hr_source"] = "Bluetooth strap"
            else:
                target = self._target_hr(sess)
                k = 1 - math.exp(-dt / 35.0)
                r = rng_for(self.seed, self.crew_idx[cid], int(sess["elapsed_s"]), "livehr")
                sess["hr"] += (target - sess["hr"]) * k + float(r.normal(0, 0.8))
                sess["hr_source"] = "simulated shirt"
            if not sess["samples"] or sess["elapsed_s"] - sess["samples"][-1]["t"] >= 5:
                sess["samples"].append({"t": round(sess["elapsed_s"]), "hr": round(sess["hr"])})
                sess["samples"] = sess["samples"][-720:]

    def workout_view(self, cid: str) -> dict:
        sess = self.live.get(cid)
        if not sess:
            return {"active": False}
        return {"active": True, "device": sess["device"], "device_label": DEVICE_LABEL[sess["device"]],
                "settings": sess["settings"], "elapsed_s": sess["elapsed_s"], "hr": round(sess["hr"]),
                "hr_source": sess["hr_source"], "samples": sess["samples"], "sets_done": sess["sets_done"],
                "scale": sess["scale"], "target_hr": round(self._target_hr(sess))}

    def finish_workout(self, cid: str) -> dict:
        sess = self.live.pop(cid, None)
        if not sess:
            raise KeyError("no active workout")
        hrs = [s["hr"] for s in sess["samples"]] or [sess["hr"]]
        minutes = round(sess["elapsed_s"] / 60.0, 1)
        dev = sess["device"]
        s = sess["settings"]
        if dev == "ared":
            sets = sess["sets_done"] or [{"exercise": s["exercise"], "load_kg": s["load_kg"], "reps": int(s.get("reps", 10))}]
            ex: dict[str, dict] = {}
            for st in sets:
                e = ex.setdefault(st["exercise"], {"exercise": st["exercise"], "load_kg": 0, "sets": 0, "reps": 0})
                e["load_kg"] = max(e["load_kg"], st["load_kg"])
                e["sets"] += 1
                e["reps"] = max(e["reps"], st["reps"])
            details = {"exercises": list(ex.values())}
        elif dev == "t2":
            details = {"speed_kmh": s["speed_kmh"], "harness_kg": s["harness_kg"]}
        else:
            details = {"watts": s["watts"]}
        avg_hr, max_hr = round(sum(hrs) / len(hrs)), round(max(hrs))
        day = self.today
        self.db.execute("INSERT INTO workouts(crew_id, day, device, minutes, avg_hr, max_hr, details, source, created_real) "
                        "VALUES (?,?,?,?,?,?,?, 'user', ?)", (cid, day, dev, minutes, avg_hr, max_hr, dumps(details), self.real()))
        slot = "ared" if dev == "ared" else "cardio"
        task = self.db.one("SELECT * FROM tasks WHERE crew_id=? AND day=? AND task_id=?", (cid, day, f"workout:{slot}"))
        if task and task["status"] != "done":
            self.confirm_task(cid, f"workout:{slot}", via="live")
        self.log(cid, "workout", "info", f"Logged {DEVICE_LABEL[dev]}: {minutes} min, avg HR {avg_hr}, max HR {max_hr}")
        return {"device": dev, "minutes": minutes, "avg_hr": avg_hr, "max_hr": max_hr, "details": details,
                "samples": sess["samples"], "day": day}

    def cancel_workout(self, cid: str) -> None:
        self.live.pop(cid, None)
