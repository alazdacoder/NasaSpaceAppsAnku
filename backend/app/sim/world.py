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
from ..config import phase_of
from ..db import DB, dumps
from ..engine.response import protocol_response
from ..engine.rules import LEVELS, evaluate_crew
from ..engine.stats import ewma
from ..engine.lsah import tests_on
from ..engine.vestibular import readiness_level
from ..link.groundlink import GroundLink
from .model import (CrewState, DayInputs, block_kcal, caox_supersaturation, day_schedule, kcal_per_min,
                    landing_day, landing_effects, planned_sessions, rng_for, session_kcal, simulate_day, slot_of,
                    water_target)

DEVICE_LABEL = {"ared": "ARED", "t2": "T2 treadmill", "cevis": "CEVIS cycle", "rehab": "Reconditioning"}
DEVICE_LABEL_TR = {"ared": "ARED", "t2": "T2 koşu bandı", "cevis": "CEVIS bisiklet", "rehab": "Yeniden kondisyonlama"}
HR_SOURCE_TR = {"simulated shirt": "simüle tişört", "Bluetooth strap": "Bluetooth kemeri"}
ARED_EX_TR = {"squat": "squat", "deadlift": "deadlift", "heel raise": "topuk kaldırma", "bench press": "bench press"}


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
        self.landing_day = landing_day(cfg)
        for aid in ("posturography", "dxa"):
            self.adapter_by_id[aid].landing_day = self.landing_day   # type: ignore[attr-defined]
        self.link = GroundLink(db, cfg, real_clock)
        self.link.on_profile_change.append(self._profile_changed)
        self.autopilot = {cid: True for cid in self.crew_ids}
        self.day_seconds = float(sim["day_seconds_default"])
        self.first_day = -int(sim["preflight_days"])
        self.last_day = int(sim["mission_days"]) + int(sim.get("postflight_days", 0)) - 1
        self.mission_t = float(self.first_day)
        self._last_real = self.real()
        self._last_snapshot = 0.0
        self.version = 0
        self._eval_cache: dict[str, tuple[tuple, dict]] = {}
        self._ground_cache: dict[str, tuple[tuple, dict]] = {}
        self._sot_base: dict[str, float | None] = {}
        self._series: dict[str, dict] = {}     # onboard samples per crew, kept in step with the database
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

    def phase(self, day: int | None = None) -> str:
        return phase_of(self.cfg, self.today if day is None else day)

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
        params = {k: v for k, v in inj.items() if k not in ("label", "label_tr", "days")}
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

    def advance(self, days: float, quiet_between: bool = False) -> None:
        end = self.last_day + 1 - 1e-6
        target = min(self.mission_t + days, end)
        while math.floor(target) > self.today:
            d = self.today
            self._close_day(d)
            self.mission_t = float(d + 1)
            self._begin_day(d + 1, quiet=quiet_between and math.floor(target) > d + 1)
        self.mission_t = max(self.mission_t, target)
        if self.mission_t >= end:
            self.day_seconds = 0.0

    def jump_to(self, day: int, hour: float = 8.0) -> None:
        """Demo: fast-forward (never back) to `day` at `hour` crew time."""
        target = min(float(day) + hour / 24.0, self.last_day + 1 - 1e-6)
        if target > self.mission_t:
            for cid in list(self.live):
                self.cancel_workout(cid)
            self.advance(target - self.mission_t, quiet_between=True)
            self.send_snapshots()

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

    def series(self, cid: str) -> dict[str, tuple[list[int], list[float]]]:
        """Onboard samples up to the last closed day (read-only for callers)."""
        s = self._series.get(cid)
        if s is None:
            s = self._series[cid] = self.db.series(cid, max_day=self.last_closed_day)
        return s

    def mass(self, cid: str) -> float:
        st = self.state[cid]
        return st.mass if st.mass is not None else float(self.profiles[cid]["mass_kg"])

    # ------------------------------------------------------------- day cycle
    def _active_events(self, crew_id: str, day: int) -> list[dict]:
        rows = self.db.all("SELECT * FROM events WHERE crew_id=? AND start_day<=? AND end_day>=? AND kind!='protocol_start'",
                           (crew_id, day, day))
        return [{"kind": r["kind"], "params": json.loads(r["params"] or "{}")} for r in rows]

    def _event_kinds(self, crew_id: str, day: int) -> dict[str, dict]:
        return {e["kind"]: e["params"] for e in self._active_events(crew_id, day)}

    def planned(self, cid: str, day: int | None = None) -> list[dict]:
        day = self.today if day is None else day
        return planned_sessions(self.cfg, day, eva="eva" in self._event_kinds(cid, day))

    def schedule(self, cid: str, day: int | None = None) -> list[dict]:
        day = self.today if day is None else day
        return day_schedule(self.cfg, day, self._event_kinds(cid, day), self.link.delay_s(), self.crew_idx[cid])

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
        for slot in ("ared", "cardio", "rehab"):
            t = tasks.get(f"workout:{slot}")
            if t and t["status"] == "done" and json.loads(t["payload"] or "{}").get("via") != "live":
                done_slots.add(slot)
        water_extra, food, feeling, sup_manual = 0.0, [], None, set()
        checkin = pvt = dizziness = None
        for e in self.db.all("SELECT kind, payload FROM manual_entries WHERE crew_id=? AND day=? ORDER BY id", (crew_id, day)):
            p = json.loads(e["payload"])
            if e["kind"] == "water":
                water_extra += float(p.get("liters", 0))
            elif e["kind"] == "food":
                food.append(p)
            elif e["kind"] == "feeling":
                feeling = float(p["value"])
            elif e["kind"] == "checkin":
                checkin = p
            elif e["kind"] == "pvt":
                pvt = p
            elif e["kind"] == "dizziness":
                dizziness = float(p["value"])
            elif e["kind"] == "supplement" and p.get("protocol_id"):
                sup_manual.add(int(p["protocol_id"]))
        protocols = [{"id": p["id"], "type": p["type"], "start_day": p["start_day"]} for p in self.active_protocols(crew_id, day)]
        confirmed = {p["id"] for p in protocols
                     if tasks.get(f"supplement:{p['id']}", {}).get("status") == "done" or p["id"] in sup_manual}
        autopilot = self.autopilot[crew_id]
        rb = rng_for(self.seed, self.crew_idx[crew_id], day, "tasks")

        def did(task_id: str) -> bool:
            t = tasks.get(task_id)
            if t is None:
                return False
            if t["status"] == "done":
                return True
            return autopilot and rb.random() < self.cfg["model"]["exercise_adherence"]

        return DayInputs(
            autopilot=autopilot, user_workouts=user_w, workout_tasks_done=done_slots,
            water_task_done=tasks.get("water", {}).get("status") == "done", water_extra_l=water_extra,
            food_entries=food, feeling=feeling, checkin=checkin, pvt=pvt, dizziness=dizziness,
            prelanding_done=did("prelanding"), vest_rehab_done=did("vest_rehab"),
            lsah_done={t["id"] for t in tests_on(self.cfg, day)
                       if tasks.get(f"lsah:{t['id']}", {}).get("status") == "done" or autopilot},
            protocols=protocols, doses_confirmed=confirmed, events=self._active_events(crew_id, day),
            profile=self.link.profile, link_delay_s=self.link.delay_s())

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
            mind, en = truth["mind"], truth["energy"]
            derived = {"ex_total_min": truth["ex_min"], "ex_week_min": truth["ex_week_min"],
                       "ared_week_min": truth["ared_week_min"], "kcal_out": en["kcal_out"],
                       "kcal_exercise": en["kcal_exercise"], "workload_h": mind["workload_h"],
                       "contact_week_min": mind["contact_week_min"]}
            if "kcal" in all_samples:
                derived["energy_balance"] = all_samples["kcal"] - en["kcal_out"]
            if all(k in all_samples for k in ("feeling", "stress", "tiredness", "connection")):
                s = all_samples
                derived["wellbeing"] = ((s["feeling"] - 1) / 4 + (5 - s["stress"]) / 4 + (5 - s["tiredness"]) / 4
                                        + (s["connection"] - 1) / 4) / 4 * 100
            if all(k in all_samples for k in ("u_calcium", "u_oxalate", "u_citrate", "u_ph", "u_volume")):
                derived["caox_ss"] = caox_supersaturation(all_samples["u_calcium"], all_samples["u_oxalate"],
                                                          all_samples["u_citrate"], all_samples["u_ph"], all_samples["u_volume"])
            if day >= self.landing_day and "vest_sot" in all_samples:
                base = self.sot_baseline(cid)
                pct = 100 * (all_samples["vest_sot"] - base) / base if base else None
                derived["vest_readiness"] = readiness_level(self.cfg, pct, all_samples.get("vest_tandem"),
                                                            all_samples.get("vest_dizzy"))
            self.db.put_samples(cid, day, derived, "derived")
            all_samples.update(derived)
            cached = self._series.get(cid)
            if cached is not None:
                for m, val in all_samples.items():
                    ds, vs = cached.setdefault(m, ([], []))
                    if ds and ds[-1] >= day:          # out of order (should not happen) - reload next time
                        self._series.pop(cid, None)
                        break
                    ds.append(day)
                    vs.append(float(val))
            now = self.real()
            self.db.executemany(
                "INSERT INTO workouts(crew_id, day, device, minutes, avg_hr, max_hr, details, source, created_real) VALUES (?,?,?,?,?,?,?,?,?)",
                [(cid, day, s["device"], s["minutes"], s["avg_hr"], s["max_hr"], dumps(s["details"]), s["source"], now)
                 for s in truth["sessions"] if s["source"] != "user"])
            self.db.executemany("INSERT OR REPLACE INTO doses(crew_id, day, protocol_id, taken, source) VALUES (?,?,?,?,?)",
                                [(cid, day, pid, int(d["taken"]), d["source"]) for pid, d in truth["doses"].items()])
            self.db.executemany(
                "INSERT OR REPLACE INTO activities(crew_id, day, idx, kind, device, start_h, end_h, minutes, met, kcal) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                [(cid, day, i, a["kind"], a.get("device"), a["start"], a["end"], a["minutes"], a["met"], a["kcal"])
                 for i, a in enumerate(truth["activities"])])
            self._finalize_tasks(cid, day, truth, inp)
            self.link.enqueue(cid, "daily", {"day": day, "samples": all_samples}, day + 1.0)
        self.version += 1

    def sot_baseline(self, cid: str) -> float | None:
        if cid not in self._sot_base:
            row = self.db.one("SELECT AVG(value) v, COUNT(*) n FROM samples WHERE crew_id=? AND metric='vest_sot' AND day<0", (cid,))
            self._sot_base[cid] = row["v"] if row and row["n"] else None
        return self._sot_base[cid]

    def _finalize_tasks(self, cid: str, day: int, truth: dict, inp: DayInputs) -> None:
        for t in self.db.all("SELECT * FROM tasks WHERE crew_id=? AND day=? AND status='pending'", (cid, day)):
            tid = t["task_id"]
            status = "missed"
            if tid.startswith("workout:"):
                slot = tid.split(":")[1]
                if any(slot_of(s["device"]) == slot for s in truth["sessions"]):
                    status = "auto"
            elif tid == "water":
                status = "auto" if truth["water_l"] >= truth["water_target_l"] - 0.05 else "missed"
            elif tid.startswith("supplement:"):
                pid = int(tid.split(":")[1])
                status = "auto" if truth["doses"].get(pid, {}).get("taken") else "missed"
            elif tid.startswith("supplement_start:"):
                status = "expired"
            elif tid in ("checkin", "dizziness", "fluid_loading"):
                status = "auto" if inp.autopilot else "missed"
            elif tid == "prelanding":
                status = "auto" if inp.prelanding_done else "missed"
            elif tid == "vest_rehab":
                status = "auto" if inp.vest_rehab_done else "missed"
            elif tid.startswith("lsah:"):
                status = "auto" if tid.split(":", 1)[1] in inp.lsah_done else "missed"
            self.db.execute("UPDATE tasks SET status=? WHERE crew_id=? AND day=? AND task_id=?", (status, cid, day, tid))

    def _begin_day(self, day: int, quiet: bool = False) -> None:
        for e in self.db.all("SELECT * FROM events WHERE kind='protocol_start' AND start_day=?", (day,)):
            params = json.loads(e["params"] or "{}")
            self.start_protocol(e["crew_id"], params.get("protocol", "potassium_citrate"), day,
                                started_by="scripted", reason="Scripted demo event (poor responder)",
                                reason_tr="Senaryolu demo olayı (zayıf yanıt veren)")
        if day == self.landing_day and not quiet:
            for cid in self.crew_ids:
                self.log(cid, "landing", "info", "Landed on Earth (R+0). Post-flight balance tests start today.",
                         "Dünya'ya iniş yapıldı (R+0). Uçuş sonrası denge testleri bugün başlıyor.", mission_t=float(day))
        for cid in self.crew_ids:
            prev = {a["id"] for a in self._prev_alerts.get(cid, [])}
            ev = self.evaluation(cid)
            alerts = ev["alerts"]
            for a in alerts:
                if a["id"] not in prev and day >= 0:
                    self.log(cid, "alert", a["level"], f"{a['title']}: {a['reason']}",
                             f"{a.get('title_tr') or a['title']}: {a.get('reason_tr') or a['reason']}",
                             mission_t=float(day), send=not quiet)
            self._prev_alerts[cid] = alerts
            self._make_tasks(cid, day, ev)
        if not quiet:
            self.send_snapshots()

    def _make_tasks(self, cid: str, day: int, ev: dict) -> None:
        rows = []
        prof = self.profiles[cid]
        st = self.state[cid]
        phase = self.phase(day)

        def add(tid: str, kind: str, title: str, title_tr: str, detail: str, detail_tr: str, payload: dict | None = None):
            rows.append((tid, kind, title, detail, {**(payload or {}), "title_tr": title_tr, "detail_tr": detail_tr}))

        for plan in self.planned(cid, day):
            dev = plan["device"]
            if dev == "ared":
                ex = self.cfg["prescription"]["ared_exercises"]
                detail, detail_tr = ", ".join(ex), ", ".join(ARED_EX_TR.get(x, x) for x in ex)
            elif dev == "t2":
                v = prof["t2_speed_kmh"] * st.fitness
                detail, detail_tr = f"Run at about {v:.1f} km/h", f"Yaklaşık {v:.1f} km/sa hızla koş"
            elif dev == "rehab":
                detail, detail_tr = "Walking, strength and balance with a trainer", "Antrenörle yürüyüş, kuvvet ve denge"
            else:
                w = round(prof["cevis_watts"] * st.fitness)
                detail, detail_tr = f"Cycle at about {w} W", f"Yaklaşık {w} W ile pedal çevir"
            add(f"workout:{plan['slot']}", "workout", f"{DEVICE_LABEL[dev]} - {plan['minutes']} min",
                f"{DEVICE_LABEL_TR[dev]} - {plan['minutes']} dk", detail, detail_tr,
                {"device": dev, "minutes": plan["minutes"], "slot": plan["slot"]})
        planned_min = sum(p["minutes"] for p in self.planned(cid, day))
        tgt = water_target(self.cfg, planned_min)
        add("water", "water", f"Drink {tgt:.1f} L of water", f"{tgt:.1f} L su iç",
            "Target for today's exercise. Keeps urine above 2.5 L/day.",
            "Bugünkü egzersize göre hedef. İdrarı günde 2.5 L'nin üzerinde tutar.", {"target_l": tgt})
        for t in tests_on(self.cfg, day):
            add(f"lsah:{t['id']}", "lsah", t["label"], t.get("label_tr", t["label"]), t.get("detail", ""),
                t.get("detail_tr", t.get("detail", "")), {"test": t["id"], "category_id": t["category_id"]})
        add("checkin", "checkin", "Daily check-in: mood and stress", "Günlük durum bildirimi: ruh hali ve stres",
            "4 quick questions, about 30 seconds.", "4 kısa soru, yaklaşık 30 saniye.")
        if phase == "inflight" and day >= self.landing_day - self.cfg["vestibular"]["prelanding_training_days"]:
            left = self.landing_day - day
            add("prelanding", "prelanding", "Pre-landing balance training - 15 min", "İniş öncesi denge antrenmanı - 15 dk",
                f"Head-movement and visual-tilt drills that prepare your balance for gravity. Landing in {left} days.",
                f"Dengeni yerçekimine hazırlayan baş hareketi ve görsel eğim alıştırmaları. İnişe {left} gün var.")
        if day == self.landing_day:
            add("fluid_loading", "fluid", "Fluid loading before deorbit", "Yörüngeden çıkış öncesi sıvı yüklemesi",
                "Drink about 1 L of water with salt tablets as briefed. It helps your blood pressure when you stand on Earth.",
                "Brifingdeki gibi tuz tabletleriyle yaklaşık 1 L su iç. Dünya'da ayağa kalktığında tansiyonunu destekler.")
        if phase == "postflight":
            add("dizziness", "dizziness", "Dizziness check (0-10)", "Baş dönmesi kontrolü (0-10)",
                "Rate how dizzy you feel. It sets what you may do today.",
                "Ne kadar başın döndüğünü puanla. Bugün neler yapabileceğini belirler.")
            if day > self.landing_day:
                add("vest_rehab", "vest_rehab", "Vestibular rehab - 20 min", "Vestibüler rehabilitasyon - 20 dk",
                    "Head turns while looking at a target, plus balance drills. Do them seated if you feel unsteady.",
                    "Bir hedefe bakarken baş çevirme ve denge alıştırmaları. Dengesiz hissedersen oturarak yap.")
        active = self.active_protocols(cid, day)
        for p in active:
            pdef = self.cfg["protocols"][p["type"]]
            add(f"supplement:{p['id']}", "supplement", pdef["label"], pdef.get("label_tr", pdef["label"]),
                pdef["dose_text"], pdef.get("dose_text_tr", pdef["dose_text"]), {"protocol_id": p["id"], "type": p["type"]})
        active_types = {p["type"] for p in active}
        for a in ev["alerts"]:
            if any(r["id"] == "start_k_citrate" for r in a["recs"]) and "potassium_citrate" not in active_types and phase != "postflight":
                pdef = self.cfg["protocols"]["potassium_citrate"]
                add("supplement_start:potassium_citrate", "supplement_start", f"Start {pdef['label'].lower()}",
                    f"{pdef.get('label_tr', pdef['label'])} başla".replace("sitrat başla", "sitrata başla"),
                    pdef["dose_text"], pdef.get("dose_text_tr", pdef["dose_text"]),
                    {"type": "potassium_citrate", "alert_id": a["id"], "alert_title": a["title"],
                     "alert_title_tr": a.get("title_tr"), "reason": a["reason"], "reason_tr": a.get("reason_tr"),
                     "source": pdef["source"], "verified": pdef["verified"]})
                break
        self.db.executemany(
            "INSERT OR IGNORE INTO tasks(crew_id, day, task_id, kind, title, detail, status, payload) VALUES (?,?,?,?,?,?, 'pending', ?)",
            [(cid, day, tid, kind, title, detail, dumps(payload)) for tid, kind, title, detail, payload in rows])

    # ----------------------------------------------------------- protocols
    def start_protocol(self, cid: str, ptype: str, day: int, started_by: str, reason: str, reason_tr: str | None = None) -> int:
        existing = [p for p in self.active_protocols(cid, day) if p["type"] == ptype]
        if existing:
            return existing[0]["id"]
        cur = self.db.execute("INSERT INTO protocols(crew_id, type, start_day, status, started_by, reason) VALUES (?,?,?, 'active', ?, ?)",
                              (cid, ptype, day, started_by, json.dumps({"en": reason, "tr": reason_tr or reason})))
        pid = cur.lastrowid
        pdef = self.cfg["protocols"][ptype]
        self.log(cid, "protocol", "info", f"Started {pdef['label']} ({pdef['dose_text']}) on day {day}. {reason}",
                 f"{pdef.get('label_tr', pdef['label'])} başlatıldı ({pdef.get('dose_text_tr', pdef['dose_text'])}), "
                 f"gün {day}. {reason_tr or reason}", mission_t=float(day))
        self.version += 1
        return pid

    def protocol_results(self, cid: str, series: dict | None = None, today: int | None = None) -> list[dict]:
        series = series if series is not None else self.db.series(cid)
        today = self.last_closed_day if today is None else today
        out = []
        for p in self.db.all("SELECT * FROM protocols WHERE crew_id=? AND start_day<=? ORDER BY id", (cid, today + 1)):
            pdef = self.cfg["protocols"][p["type"]]
            sm = {}
            for t in pdef["targets"]:
                days, vals = series.get(t["metric"], ([], []))
                alpha = self.cfg["metrics"][t["metric"]].get("ewma_alpha", self.cfg["defaults"]["ewma_alpha"])
                sm[t["metric"]] = {"days": days, "ewma": ewma(vals, alpha) if vals else []}
            res = protocol_response(sm, pdef["targets"], p["start_day"], today, pdef.get("stop_at_target", True),
                                    pdef.get("days_to_target_fraction", 0.9))
            tdefs = {x["metric"]: x for x in pdef["targets"]}
            for t in res["targets"]:
                t["label_tr"] = tdefs[t["metric"]].get("label_tr")
            doses = self.db.one("SELECT COUNT(*) n, SUM(taken) t FROM doses WHERE protocol_id=? AND day<=?", (p["id"], today))
            try:
                reason = json.loads(p["reason"])
            except (TypeError, ValueError):
                reason = {"en": p["reason"], "tr": p["reason"]}
            res.update({"protocol_id": p["id"], "type": p["type"], "label": pdef["label"], "label_tr": pdef.get("label_tr"),
                        "dose_text": pdef["dose_text"], "dose_text_tr": pdef.get("dose_text_tr"),
                        "start_day": p["start_day"], "status": p["status"], "started_by": p["started_by"],
                        "reason": reason.get("en"), "reason_tr": reason.get("tr"),
                        "days_since_start": max(0, today - p["start_day"] + 1),
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
        series = self.series(cid)
        presults = self.protocol_results(cid, series)
        ev = evaluate_crew(self.cfg, series, self.last_closed_day, presults, self.phase(self.last_closed_day))
        ev["protocols"] = presults
        self._eval_cache[cid] = (key, ev)
        return ev

    def ground_series(self, cid: str) -> tuple[dict, int]:
        series = self.db.series(cid, table="g_samples")
        last = max((d[-1] for d, _ in series.values() if d), default=self.first_day - 1)
        return series, last

    def ground_evaluation(self, cid: str) -> tuple[dict, dict, int]:
        """The same rules run on the ground copy (only what arrived through the link)."""
        row = self.db.one("SELECT COUNT(*) n, MAX(day) d FROM g_samples WHERE crew_id=?", (cid,))
        key = (row["n"], row["d"], self.version)
        cached = self._ground_cache.get(cid)
        if cached and cached[0] == key:
            return cached[1]
        series, last = self.ground_series(cid)
        presults = self.protocol_results(cid, series, last)
        ev = evaluate_crew(self.cfg, series, last, presults, self.phase(last))
        ev["protocols"] = presults
        out = (ev, series, last)
        self._ground_cache[cid] = (key, out)
        return out

    # ------------------------------------------------------------------ tasks
    def tasks(self, cid: str, day: int | None = None) -> list[dict]:
        day = self.today if day is None else day
        rows = self.db.all("SELECT * FROM tasks WHERE crew_id=? AND day=? ORDER BY rowid", (cid, day))
        for r in rows:
            r["payload"] = json.loads(r["payload"] or "{}")
            r["title_tr"] = r["payload"].get("title_tr")
            r["detail_tr"] = r["payload"].get("detail_tr")
        order = {"supplement_start": 0, "fluid": 1, "lsah": 2, "dizziness": 2, "workout": 3, "vest_rehab": 4,
                 "prelanding": 5, "supplement": 6, "water": 7, "checkin": 8}
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
                                      reason=f"Accepted from alert: {payload.get('alert_title', '')}",
                                      reason_tr=f"Uyarıdan kabul edildi: {payload.get('alert_title_tr') or payload.get('alert_title', '')}")
            pdef = self.cfg["protocols"][payload["type"]]
            self.db.execute("INSERT OR IGNORE INTO tasks(crew_id, day, task_id, kind, title, detail, status, payload, confirmed_mission_t) "
                            "VALUES (?,?,?,?,?,?, 'done', ?, ?)",
                            (cid, day, f"supplement:{pid}", "supplement", pdef["label"], pdef["dose_text"],
                             dumps({"protocol_id": pid, "type": payload["type"], "via": via,
                                    "title_tr": pdef.get("label_tr"), "detail_tr": pdef.get("dose_text_tr")}), self.mission_t))
            payload["protocol_id"] = pid
        self.db.execute("UPDATE tasks SET status='done', confirmed_mission_t=?, payload=? WHERE crew_id=? AND day=? AND task_id=?",
                        (self.mission_t, dumps(payload), cid, day, task_id))
        self.log(cid, "task", "info", f"Confirmed: {t['title']}", f"Onaylandı: {payload.get('title_tr') or t['title']}")
        self.send_snapshots([cid])
        return self.db.one("SELECT * FROM tasks WHERE crew_id=? AND day=? AND task_id=?", (cid, day, task_id))

    def _mark_done(self, cid: str, task_id: str) -> None:
        self.db.execute("UPDATE tasks SET status='done', confirmed_mission_t=? WHERE crew_id=? AND day=? AND task_id=? AND status!='done'",
                        (self.mission_t, cid, self.today, task_id))

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
        elif kind == "checkin":
            out = {}
            for k in ("feeling", "stress", "tiredness", "connection"):
                v = int(payload[k])
                if not 1 <= v <= 5:
                    raise ValueError(f"{k} must be 1-5")
                out[k] = v
            payload = out
        elif kind == "pvt":
            rt, lapses, trials = float(payload["mean_rt_ms"]), int(payload["lapses"]), int(payload.get("trials", 0))
            if not 100 <= rt <= 2000 or not 0 <= lapses <= 100:
                raise ValueError("reaction time must be 100-2000 ms and lapses 0-100")
            payload = {"mean_rt_ms": rt, "lapses": lapses, "trials": trials}
        elif kind == "dizziness":
            v = int(payload["value"])
            if not 0 <= v <= 10:
                raise ValueError("dizziness must be 0-10")
            payload = {"value": v}
        elif kind == "supplement":
            payload = {"protocol_id": int(payload["protocol_id"])}
        else:
            raise KeyError(kind)
        self.db.execute("INSERT INTO manual_entries(crew_id, day, kind, payload, created_real, mission_t) VALUES (?,?,?,?,?,?)",
                        (cid, self.today, kind, dumps(payload), self.real(), self.mission_t))
        if kind == "supplement":
            self._mark_done(cid, f"supplement:{payload['protocol_id']}")
        elif kind == "checkin":
            self._mark_done(cid, "checkin")
            if payload["stress"] >= 4 or payload["feeling"] <= 2:
                self.log(cid, "checkin", "warn", f"Check-in: feeling {payload['feeling']}/5, stress {payload['stress']}/5",
                         f"Durum bildirimi: his {payload['feeling']}/5, stres {payload['stress']}/5")
        elif kind == "dizziness":
            self._mark_done(cid, "dizziness")
        self.send_snapshots([cid])
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
            self._series.pop(r[0], None)
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
        params = {k: v for k, v in inj.items() if k not in ("label", "label_tr", "days")}
        self.db.execute("INSERT INTO events(crew_id, kind, start_day, end_day, params, origin, created_real) VALUES (?,?,?,?,?,?,?)",
                        (cid, kind, start, start + n - 1, dumps(params), "injected", self.real()))
        self.log(cid, "event", "warn", f"Injected event: {inj['label']} for {n} day(s) from day {start}",
                 f"Eklenen olay: {inj.get('label_tr', inj['label'])}, gün {start} itibarıyla {n} gün")
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
            inj = self.cfg["injectable_events"].get(r["kind"], {})
            r["label"] = inj.get("label", r["kind"].replace("_", " "))
            r["label_tr"] = inj.get("label_tr")
        return rows

    def log(self, cid: str | None, kind: str, level: str, text: str, text_tr: str | None = None,
            mission_t: float | None = None, send: bool = True) -> None:
        mt = self.mission_t if mission_t is None else mission_t
        self.db.execute("INSERT INTO event_log(crew_id, mission_t, created_real, kind, level, text, text_tr) VALUES (?,?,?,?,?,?,?)",
                        (cid, mt, self.real(), kind, level, text, text_tr))
        if send:
            self.link.enqueue(cid, "event", {"kind": kind, "level": level, "text": text, "text_tr": text_tr}, mt)

    def _profile_changed(self, profile: str) -> None:
        p = self.cfg["link"]["profiles"][profile]
        self.log(None, "link", "info", f"Mission profile changed to {p['label']}",
                 f"Görev profili değişti: {p.get('label_tr', p['label'])}")

    # -------------------------------------------------------------- snapshots
    def snapshot(self, cid: str) -> dict:
        ev = self.evaluation(cid)
        live = {}
        for aid in ("biomonitor", "tmini", "co2"):
            live.update(self.adapter_by_id[aid].live(cid, self.mission_t, self))
        return {
            "crew_id": cid, "mission_t": self.mission_t, "today": self.today, "overall": ev["overall"],
            "phase": self.phase(),
            "alerts": [{k: a.get(k) for k in ("id", "title", "title_tr", "level", "reason", "reason_tr", "kind")}
                       | {"recs": [r["text"] for r in a["recs"]], "recs_tr": [r.get("text_tr") or r["text"] for r in a["recs"]]}
                       for a in ev["alerts"]],
            "protocols": [{k: p.get(k) for k in ("protocol_id", "label", "label_tr", "score", "start_day", "days_since_start",
                                                  "days_to_target_left", "adherence", "started_by")}
                          | {"targets": [{k: t.get(k) for k in ("metric", "label", "label_tr", "start", "target", "current", "progress")}
                                         for t in p["targets"]]} for p in ev["protocols"]],
            "tasks": [{"task_id": t["task_id"], "kind": t["kind"], "title": t["title"], "title_tr": t["title_tr"],
                       "detail": t["detail"], "detail_tr": t["detail_tr"], "status": t["status"]} for t in self.tasks(cid)],
            "live": live, "workout_active": cid in self.live,
            "live_kcal": round(self.live[cid]["kcal"]) if cid in self.live else None,
            "metrics": {m: {"value": e["value"], "ewma": e["ewma"], "z": e["z"], "status": e["status"], "day": e["day"]}
                        for m, e in ev["metrics"].items()},
        }

    def send_snapshots(self, crew_ids: list[str] | None = None) -> None:
        for cid in crew_ids or self.crew_ids:
            self.link.enqueue(cid, "state", self.snapshot(cid), self.mission_t)
        if crew_ids is None:
            self._last_snapshot = self.real()

    # ------------------------------------------------------- energy (today)
    def energy_today(self, cid: str) -> dict:
        """Today's schedule with energy burned so far (crew time), live workout included."""
        mass = self.mass(cid)
        hour = (self.mission_t - self.today) * 24.0
        blocks = self.schedule(cid)
        logged: dict[str, list[dict]] = {}
        for w in self.db.all("SELECT * FROM workouts WHERE crew_id=? AND day=? AND source='user' ORDER BY id", (cid, self.today)):
            det = json.loads(w["details"] or "{}")
            kc = det.get("kcal") or session_kcal(self.cfg, w["device"], det, w["minutes"], mass)
            logged.setdefault(slot_of(w["device"]), []).append({"device": w["device"], "minutes": w["minutes"], "kcal": kc})
        tasks = {t["task_id"]: t for t in self.tasks(cid)}
        plan = {p["slot"]: p for p in self.planned(cid)}
        live = self.live.get(cid)
        out = []
        for b in blocks:
            hours = b["end"] - b["start"]
            item: dict[str, Any] = {"kind": b["kind"], "start": b["start"], "end": b["end"], "minutes": round(hours * 60)}
            if b.get("overtime"):
                item["overtime"] = True
            if b["kind"] == "exercise":
                slot = b.get("slot")
                p = plan.get(slot or "")
                if p is None:
                    met, kc = block_kcal(self.cfg, "rest", hours, mass)
                    item.update({"kind": "rest", "met": met, "kcal_total": kc})
                else:
                    item.update({"slot": slot, "device": p["device"]})
                    sessions = logged.get(slot or "", [])
                    if sessions:
                        item.update({"kcal_total": sum(s["kcal"] for s in sessions), "status": "done", "logged": True,
                                     "minutes": round(sum(s["minutes"] for s in sessions))})
                    else:
                        settings = self._default_settings(cid, p["device"])
                        rate = kcal_per_min(self.cfg, p["device"], settings, mass)
                        item.update({"kcal_total": rate * p["minutes"], "met": round(rate * 60 / mass, 1),
                                     "estimate": True})
                        task = tasks.get(f"workout:{slot}")
                        if task and task["status"] == "done":
                            item["status"] = "done"
            else:
                met, kc = block_kcal(self.cfg, b["kind"], hours, mass)
                item.update({"met": met, "kcal_total": kc})
            if "status" not in item:
                item["status"] = "done" if hour >= b["end"] else "now" if hour >= b["start"] else "next"
            frac = 1.0 if item["status"] == "done" else max(0.0, min(1.0, (hour - b["start"]) / hours)) if hours else 0.0
            if item.get("estimate") and item["status"] != "done":
                frac = 0.0        # planned session not done yet; a running live session is counted separately
            item["kcal_so_far"] = item["kcal_total"] * frac
            item["kcal_total"] = round(item["kcal_total"], 1)
            item["kcal_so_far"] = round(item["kcal_so_far"], 1)
            out.append(item)
        live_kcal = round(live["kcal"], 1) if live else 0.0
        so_far = sum(x["kcal_so_far"] for x in out) + live_kcal
        expected = sum(x["kcal_total"] for x in out)
        return {"hour": hour, "mass_kg": round(mass, 1), "blocks": out, "kcal_so_far": round(so_far),
                "kcal_expected": round(expected), "live": ({"device": live["device"], "kcal": live_kcal,
                                                             "kcal_min": round(live["kcal_min"], 1)} if live else None),
                "workload_h": round(sum(b["end"] - b["start"] for b in blocks
                                        if b["kind"] in self.cfg["schedule"]["work_kinds"]), 1)}

    # ----------------------------------------------------- return to Earth
    def landing_prediction(self, cid: str) -> dict:
        """Expected landing-day effects if the remaining pre-landing training is done."""
        st = self.state[cid]
        vc = self.cfg["vestibular"]
        window_start = self.landing_day - vc["prelanding_training_days"]
        remaining = max(0, self.landing_day - max(self.today, window_start))
        now = landing_effects(self.cfg, self.profiles[cid], st.prelanding_days, st.fitness)
        best = landing_effects(self.cfg, self.profiles[cid], min(vc["prelanding_training_days"], st.prelanding_days + remaining),
                               st.fitness)
        return {"if_all_training": best, "training_so_far": now,
                "training_done": st.prelanding_days, "training_planned": vc["prelanding_training_days"],
                "training_window_start": window_start, "landing_effects": st.landing}

    # ---------------------------------------------------------- live workout
    def _default_settings(self, cid: str, device: str) -> dict:
        prof = self.profiles[cid]
        st = self.state[cid]
        return {
            "ared": {"exercise": "squat", "load_kg": round(prof["ared_squat_kg"] * st.strength), "sets": 3, "reps": 10},
            "t2": {"speed_kmh": round(prof["t2_speed_kmh"] * st.fitness, 1), "harness_kg": round(prof["mass_kg"] * 0.7)},
            "cevis": {"watts": round(prof["cevis_watts"] * st.fitness)},
            "rehab": {},
        }[device]

    def start_workout(self, cid: str, device: str, settings: dict) -> dict:
        allowed = ("rehab",) if self.phase() == "postflight" else ("ared", "t2", "cevis")
        if device not in allowed:
            raise ValueError(f"device must be one of: {', '.join(allowed)}")
        now = self.real()
        hr0 = float(self.last_truth(cid)["vitals"]["hr_rest"]) + 10 if self.last_truth(cid) else 70.0
        merged = {**self._default_settings(cid, device), **{k: v for k, v in (settings or {}).items() if v is not None}}
        self._clamp(merged)
        sess = {"crew_id": cid, "device": device, "settings": merged, "start_real": now,
                "last_real": now, "elapsed_s": 0.0, "hr": hr0, "samples": [], "sets_done": [], "day": self.today,
                "scale": float(self.cfg["simulation"]["workout_time_scale"]), "hr_source": "simulated shirt",
                "kcal": 0.0, "kcal_min": kcal_per_min(self.cfg, device, merged, self.mass(cid))}
        self.live[cid] = sess
        self.log(cid, "workout", "info", f"Started live {DEVICE_LABEL[device]} session",
                 f"Canlı {DEVICE_LABEL_TR[device]} seansı başladı")
        return self.workout_view(cid)

    def update_workout(self, cid: str, settings: dict | None = None, log_set: bool = False) -> dict:
        sess = self.live.get(cid)
        if not sess:
            raise KeyError("no active workout")
        if settings:
            sess["settings"].update({k: v for k, v in settings.items() if v is not None})
            self._clamp(sess["settings"])
            sess["kcal_min"] = kcal_per_min(self.cfg, sess["device"], sess["settings"], self.mass(cid))
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
        elif sess["device"] == "rehab":
            t = rest + 30
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
            sess["kcal"] += sess["kcal_min"] * dt / 60.0
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
                sess["samples"].append({"t": round(sess["elapsed_s"]), "hr": round(sess["hr"]), "kcal": round(sess["kcal"], 1)})
                sess["samples"] = sess["samples"][-720:]

    def workout_view(self, cid: str) -> dict:
        sess = self.live.get(cid)
        if not sess:
            return {"active": False}
        return {"active": True, "device": sess["device"], "device_label": DEVICE_LABEL[sess["device"]],
                "device_label_tr": DEVICE_LABEL_TR[sess["device"]],
                "settings": sess["settings"], "elapsed_s": sess["elapsed_s"], "hr": round(sess["hr"]),
                "hr_source": sess["hr_source"], "hr_source_tr": HR_SOURCE_TR.get(sess["hr_source"]),
                "samples": sess["samples"], "sets_done": sess["sets_done"],
                "scale": sess["scale"], "target_hr": round(self._target_hr(sess)),
                "kcal": round(sess["kcal"], 1), "kcal_min": round(sess["kcal_min"], 1),
                "met": round(sess["kcal_min"] * 60 / self.mass(cid), 1)}

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
            details: dict[str, Any] = {"exercises": list(ex.values())}
        elif dev == "t2":
            details = {"speed_kmh": s["speed_kmh"], "harness_kg": s["harness_kg"]}
        elif dev == "rehab":
            details = {"focus": "walking, strength, balance"}
        else:
            details = {"watts": s["watts"]}
        details["kcal"] = round(sess["kcal"], 1)
        avg_hr, max_hr = round(sum(hrs) / len(hrs)), round(max(hrs))
        day = self.today
        self.db.execute("INSERT INTO workouts(crew_id, day, device, minutes, avg_hr, max_hr, details, source, created_real) "
                        "VALUES (?,?,?,?,?,?,?, 'user', ?)", (cid, day, dev, minutes, avg_hr, max_hr, dumps(details), self.real()))
        slot = slot_of(dev)
        task = self.db.one("SELECT * FROM tasks WHERE crew_id=? AND day=? AND task_id=?", (cid, day, f"workout:{slot}"))
        if task and task["status"] != "done":
            self.confirm_task(cid, f"workout:{slot}", via="live")
        self.log(cid, "workout", "info",
                 f"Logged {DEVICE_LABEL[dev]}: {minutes} min, avg HR {avg_hr}, max HR {max_hr}, {details['kcal']:.0f} kcal",
                 f"{DEVICE_LABEL_TR[dev]} kaydedildi: {minutes} dk, ort. nabız {avg_hr}, en yüksek {max_hr}, {details['kcal']:.0f} kcal")
        return {"device": dev, "device_label": DEVICE_LABEL[dev], "device_label_tr": DEVICE_LABEL_TR[dev], "minutes": minutes,
                "avg_hr": avg_hr, "max_hr": max_hr, "details": details, "kcal": details["kcal"],
                "samples": sess["samples"], "day": day}

    def cancel_workout(self, cid: str) -> None:
        self.live.pop(cid, None)
