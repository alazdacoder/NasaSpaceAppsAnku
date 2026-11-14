"""HTTP + WebSocket API.

/api/crew/...     crew data. `?side=crew` (default, astronaut portal) reads the ONBOARD
                  database; `?side=ground` (lab-team portal) reads only the GROUND copy that
                  arrived through the link, so it lags by the link delay.
/api/surgeon/...  lab-team overview - reads the GROUND tables only (link-delayed).
/api/demo/...     demo controls (mission profile, clock speed, events, jump to landing).

Every response is localized (English / Turkish) on the way out - see app/i18n.py.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from ..config import phase_of, unverified_items
from ..engine.lsah import age_on, annual_plan, mission_date, test_days
from ..engine.rules import evaluate_metric
from ..engine.stats import ewma_days, pearson
from ..engine.vestibular import balance_recovery, level_info
from ..i18n import LANG, LocalizedJSONResponse, localize, tr
from ..services import osdr
from ..sim.model import kcal_per_min, water_target
from ..sim.world import DEVICE_LABEL, DEVICE_LABEL_TR
from ..state import AppState

router = APIRouter(prefix="/api", default_response_class=LocalizedJSONResponse)
ws_router = APIRouter()
STATE: AppState | None = None


def W():
    assert STATE is not None
    return STATE.world


def _crew(cid: str) -> dict:
    w = W()
    if cid not in w.profiles:
        raise HTTPException(404, f"unknown crew {cid}")
    return w.profiles[cid]


# ---------------------------------------------------------------- helpers
def metric_info(mid: str) -> dict:
    cfg = W().cfg
    m = cfg["metrics"][mid]
    rules = [{"type": r["type"], "value": r["value"], "level": r["level"], "source": r["source"],
              "verified": r["verified"], "rec": r.get("rec")} for r in m.get("rules", [])]
    verified = all(r["verified"] for r in rules) and m.get("estimate_verified", True) is not False
    return {"metric": mid, "label": m["label"], "label_tr": m.get("label_tr"), "unit": m.get("unit", ""),
            "unit_tr": m.get("unit_tr"), "decimals": m.get("decimals", 1), "group": m.get("group"),
            "device": m.get("device"), "meaning": m.get("meaning", ""), "meaning_tr": m.get("meaning_tr"),
            "direction": m.get("direction"), "thresholds": rules, "verified": verified,
            "estimate_note": m.get("estimate_note"), "estimate_note_tr": m.get("estimate_note_tr"), "has_rules": bool(rules)}


def metric_payload(series: dict, mid: str, today: int, ev: dict | None = None) -> dict:
    cfg = W().cfg
    info = metric_info(mid)
    days, vals = series.get(mid, ([], []))
    if ev is None and vals:
        ev = evaluate_metric(mid, cfg["metrics"][mid], days, vals, cfg["defaults"], today, phase_of(cfg, today))
    alpha = cfg["metrics"][mid].get("ewma_alpha", cfg["defaults"]["ewma_alpha"])
    sm = ewma_days(days, vals, alpha) if vals else []
    points = [{"day": d, "value": v, "ewma": s} for d, v, s in zip(days, vals, sm)]
    out = {**info, "points": points}
    if ev:
        out.update({k: ev[k] for k in ("value", "ewma", "baseline_mean", "baseline_sd", "z", "pct", "slope",
                                       "anomaly", "status", "triggered", "day", "stale")})
    else:
        out.update({"value": None, "ewma": None, "status": "green", "triggered": [], "baseline_mean": None})
    return out


class View:
    """What one portal may see of one crew member: onboard (crew) or the ground copy."""

    def __init__(self, cid: str, side: str = "crew"):
        w = W()
        self.cid = cid
        self.ground = side == "ground"
        if self.ground:
            self.ev, self.series, self.last_day = w.ground_evaluation(cid)
        else:
            self.ev = w.evaluation(cid)
            self.series = w.series(cid)
            self.last_day = w.last_closed_day

    def metrics(self, mids: list[str]) -> dict[str, dict]:
        return {m: metric_payload(self.series, m, self.last_day, self.ev["metrics"].get(m)) for m in mids}

    def g_state(self) -> dict | None:
        return W().db.one("SELECT * FROM g_state WHERE crew_id=?", (self.cid,))

    def live(self) -> dict:
        if not self.ground:
            return live_now(self.cid)
        row = self.g_state()
        return json.loads(row["payload"]).get("live", {}) if row else {}

    def tasks(self) -> list[dict]:
        if not self.ground:
            return W().tasks(self.cid)
        row = self.g_state()
        return json.loads(row["payload"]).get("tasks", []) if row else []

    def info(self) -> dict:
        w = W()
        out: dict[str, Any] = {"side": "ground" if self.ground else "crew", "data_day": self.last_day,
                               "phase": phase_of(w.cfg, self.last_day)}
        if self.ground:
            row = self.g_state()
            if row:
                out.update({"state_mission_t": row["mission_t"], "state_age_s": w.real() - row["created_real"]})
        return out


def mids_in(group: str) -> list[str]:
    return [m for m, d in W().cfg["metrics"].items() if d.get("group") == group]


def clock_payload() -> dict:
    w = W()
    frac = w.mission_t - w.today
    phase = w.phase()
    return {"mission_t": w.mission_t, "today": w.today, "hour": frac * 24, "day_seconds": w.day_seconds,
            "phase": phase, "mission_days": w.landing_day, "landing_day": w.landing_day, "last_day": w.last_day,
            "r_day": w.today - w.landing_day if phase == "postflight" else None,
            "days_to_landing": w.landing_day - w.today if phase != "postflight" else None,
            "date": mission_date(w.cfg, w.today).isoformat(),
            "day_seconds_options": w.cfg["simulation"]["day_seconds_options"], "seed": w.seed,
            "finished": w.mission_t >= w.last_day + 1 - 1e-5}


def live_now(cid: str) -> dict:
    w = W()
    out: dict[str, Any] = {}
    for aid in ("biomonitor", "tmini", "co2"):
        out.update(w.adapter_by_id[aid].live(cid, w.mission_t, w))
    return out


def device_label(dev: str) -> dict:
    return {"label": DEVICE_LABEL.get(dev, dev), "label_tr": DEVICE_LABEL_TR.get(dev)}


def alerts_for(ev: dict, groups: set[str]) -> list[dict]:
    cfg = W().cfg
    return [a for a in ev["alerts"] if any(cfg["metrics"][m].get("group") in groups for m in a["metrics"])]


# ------------------------------------------------------------------ meta
@router.get("/meta")
async def meta():
    w = W()
    cfg = w.cfg
    return {"app_name": cfg["meta"]["app_name"], "disclaimer": cfg["meta"]["disclaimer"],
            "disclaimer_tr": cfg["meta"].get("disclaimer_tr"),
            "crew": [{"id": c["id"], "name": c["name"], "role": c["role"], "role_tr": c.get("role_tr"), "sex": c.get("sex"),
                      "birth": c.get("birth"), "flights": c.get("flights")} for c in w.crew],
            "clock": clock_payload(), "link": w.link.status(),
            "profiles": {k: {"label": v["label"], "label_tr": v.get("label_tr"), "delay_s": v["delay_s"],
                             "delay_min_s": v.get("delay_min_s", v["delay_s"]),
                             "delay_max_s": v.get("delay_max_s", v["delay_s"]), "verified": v["verified"]}
                         for k, v in cfg["link"]["profiles"].items()},
            "injectable_events": {k: {"label": v["label"], "label_tr": v.get("label_tr"), "days": v["days"]}
                                  for k, v in cfg["injectable_events"].items()},
            "metrics": {m: metric_info(m) for m in cfg["metrics"]}}


@router.get("/clock")
async def clock():
    w = W()
    return {**clock_payload(), "link": w.link.status()}


# ------------------------------------------------------------------ crew
@router.get("/crew/{cid}/today")
async def today(cid: str):
    prof = _crew(cid)
    w = W()
    v = View(cid)
    ev = v.ev
    m = ev["metrics"]
    sleep = {k: metric_payload({}, k, w.last_closed_day, m.get(k)) for k in ("sleep_h", "sleep_quality")}
    for s in sleep.values():
        s.pop("points", None)
    planned = sum(p["minutes"] for p in w.planned(cid))
    energy = w.energy_today(cid)
    entries = w.manual_today(cid)
    checkin = next((e["payload"] for e in reversed(entries) if e["kind"] == "checkin"), None)
    readiness = None
    if w.phase() == "postflight":
        lv = m.get("vest_readiness")
        level = int(lv["value"]) if lv and lv["day"] >= w.landing_day else 0
        readiness = level_info(w.cfg, level)
    return {"crew": {"id": cid, "name": prof["name"], "role": prof["role"], "role_tr": prof.get("role_tr")},
            "clock": clock_payload(), "overall": ev["overall"], "alerts": ev["alerts"], "tasks": w.tasks(cid),
            "sleep": sleep, "water_target_l": water_target(w.cfg, planned),
            "protocols": [{k: p.get(k) for k in ("protocol_id", "label", "label_tr", "score", "days_since_start",
                                                  "days_to_target_left", "dose_text", "dose_text_tr")}
                          for p in ev["protocols"] if p["status"] == "active"],
            "energy": {k: energy[k] for k in ("kcal_so_far", "kcal_expected", "live")},
            "intake_yesterday": m.get("kcal", {}).get("value"),
            "mind": {"checkin": checkin, "wellbeing": m.get("wellbeing", {}).get("value"),
                     "stress": m.get("stress", {}).get("ewma")},
            "readiness": readiness,
            "live": live_now(cid), "autopilot": w.autopilot[cid], "workout_active": cid in w.live,
            "link": w.link.status()}


@router.post("/crew/{cid}/tasks/{task_id}/confirm")
async def confirm(cid: str, task_id: str):
    _crew(cid)
    try:
        t = W().confirm_task(cid, task_id)
    except KeyError:
        raise HTTPException(404, "task not found for today")
    return {"ok": True, "task": t}


@router.get("/crew/{cid}/alerts")
async def alerts(cid: str, side: str = "crew"):
    _crew(cid)
    v = View(cid, side)
    return {"overall": v.ev["overall"], "alerts": v.ev["alerts"], "day": v.ev["today"], "view": v.info()}


@router.get("/crew/{cid}/live")
async def live(cid: str):
    _crew(cid)
    return {"clock": clock_payload(), "live": live_now(cid)}


@router.get("/crew/{cid}/body")
async def body(cid: str, side: str = "crew"):
    _crew(cid)
    v = View(cid, side)
    return {"live": v.live(), "vitals": v.metrics(mids_in("vitals")), "sleep": v.metrics(mids_in("sleep")),
            "kidney": v.metrics(["caox_ss", "u_volume"]), "environment": v.metrics(["co2_mmhg", "rad_cum"]),
            "alerts": alerts_for(v.ev, {"vitals", "sleep"}), "clock": clock_payload(), "view": v.info()}


@router.get("/crew/{cid}/exercise")
async def exercise(cid: str, side: str = "crew"):
    prof = _crew(cid)
    w = W()
    cfg = w.cfg
    v = View(cid, side)
    rows = w.db.all("SELECT * FROM workouts WHERE crew_id=? AND day<=? ORDER BY day, id",
                    (cid, v.last_day if v.ground else w.today))
    weeks: dict[int, dict] = defaultdict(lambda: {"ared": 0.0, "t2": 0.0, "cevis": 0.0, "rehab": 0.0})
    strength: dict[str, list] = defaultdict(list)
    sessions = []
    for r in rows:
        det = json.loads(r["details"] or "{}")
        wk = r["day"] // 7
        weeks[wk][r["device"]] += r["minutes"]
        for e in det.get("exercises", []):
            strength[e["exercise"]].append({"day": r["day"], "load_kg": e["load_kg"]})
        sessions.append({"id": r["id"], "day": r["day"], "device": r["device"], "minutes": r["minutes"],
                         "avg_hr": r["avg_hr"], "max_hr": r["max_hr"], "details": det, "source": r["source"],
                         "kcal": det.get("kcal")})
    week_list = [{"week": k, "label": f"W{k}" if k >= 0 else f"Pre{k}", "label_tr": f"H{k}" if k >= 0 else f"Ö{k}",
                  **{d: round(x) for d, x in weeks[k].items()}, "total": round(sum(weeks[k].values()))}
                 for k in sorted(weeks)]
    strength_out = {}
    for ex, pts in strength.items():
        best: dict[int, float] = {}
        for p in pts:
            best[p["day"]] = max(best.get(p["day"], 0), p["load_kg"])
        strength_out[ex] = [{"day": d, "load_kg": x} for d, x in sorted(best.items())]
    ref_day = v.last_day if v.ground else w.today
    today_minutes = sum(s["minutes"] for s in sessions if s["day"] == ref_day)
    last7 = sum(s["minutes"] for s in sessions if ref_day - 6 <= s["day"] <= ref_day)
    pres = cfg["prescription"]
    mass = w.mass(cid)
    today_plan = []
    for p in w.planned(cid):
        rate = kcal_per_min(cfg, p["device"], w._default_settings(cid, p["device"]), mass)
        today_plan.append({**p, **device_label(p["device"]), "kcal_est": round(rate * p["minutes"])})
    return {
        "phase": w.phase(), "today": today_plan,
        "tasks": [t for t in w.tasks(cid) if t["kind"] == "workout"],
        "weekly_target_min": pres["weekly_target_min"], "weekly_range_min": pres["weekly_range_min"],
        "last7_min": round(last7), "today_min": round(today_minutes), "weeks": week_list,
        "strength": strength_out, "sessions": sessions[-14:][::-1],
        "trends": v.metrics(["ex_week_min", "ared_squat_kg", "t2_speed_kmh", "cevis_watts", "hr_exercise", "kcal_exercise"]),
        "limits": {"ared_peak_load_kg": cfg["limits"]["ared_peak_load_kg"], "t2_peak_speed_kmh": cfg["limits"]["t2_peak_speed_kmh"],
                   "cevis_max_watts": cfg["cevis_limits"]["max_watts"], "source": cfg["limits"]["source"]},
        "ared_exercises": pres["ared_exercises"],
        "defaults": {"ared_load_kg": round(prof["ared_squat_kg"] * w.state[cid].strength),
                     "t2_speed_kmh": round(prof["t2_speed_kmh"] * w.state[cid].fitness, 1),
                     "harness_kg": round(prof["mass_kg"] * 0.7), "cevis_watts": round(prof["cevis_watts"] * w.state[cid].fitness)},
        "workout": w.workout_view(cid), "hr_rest": prof["hr_rest"], "view": v.info(),
    }


@router.get("/crew/{cid}/workout")
async def workout_get(cid: str):
    _crew(cid)
    return W().workout_view(cid)


@router.post("/crew/{cid}/workout/start")
async def workout_start(cid: str, body: dict = Body(...)):
    _crew(cid)
    w = W()
    if cid in w.live:
        raise HTTPException(409, "a workout is already running")
    try:
        return w.start_workout(cid, body.get("device", ""), body.get("settings") or {})
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/crew/{cid}/workout/update")
async def workout_update(cid: str, body: dict = Body(...)):
    _crew(cid)
    try:
        return W().update_workout(cid, body.get("settings"), bool(body.get("log_set")))
    except KeyError:
        raise HTTPException(404, "no active workout")


@router.post("/crew/{cid}/workout/finish")
async def workout_finish(cid: str):
    _crew(cid)
    w = W()
    try:
        summary = w.finish_workout(cid)
    except KeyError:
        raise HTTPException(404, "no active workout")
    days = [s for s in w.db.all("SELECT day, minutes FROM workouts WHERE crew_id=? AND day>=?", (cid, w.today - 6))]
    summary["last7_min"] = round(sum(d["minutes"] for d in days))
    summary["weekly_target_min"] = w.cfg["prescription"]["weekly_target_min"]
    summary["kcal_today"] = w.energy_today(cid)["kcal_so_far"]
    return summary


@router.post("/crew/{cid}/workout/cancel")
async def workout_cancel(cid: str):
    _crew(cid)
    W().cancel_workout(cid)
    return {"ok": True}


@router.post("/crew/{cid}/workout/hr")
async def workout_external_hr(cid: str, body: dict = Body(...)):
    """Heart rate from a real strap (Web Bluetooth in the browser)."""
    _crew(cid)
    bpm = float(body.get("bpm", 0))
    if not 25 <= bpm <= 230:
        raise HTTPException(400, "bpm out of range")
    w = W()
    w.external_hr[cid] = (bpm, w.real())
    return {"ok": True}


ACTIVITY_LABEL = {
    "sleep": ("Sleep", "Uyku"), "hygiene": ("Hygiene", "Kişisel bakım"), "meal": ("Meal", "Yemek"),
    "planning": ("Daily planning conference", "Günlük planlama toplantısı"), "science": ("Science work", "Bilimsel çalışma"),
    "maintenance": ("Maintenance", "Bakım"), "leisure": ("Free time", "Serbest zaman"),
    "family_call": ("Family call", "Aile görüşmesi"), "medical": ("Medical tests & debriefs", "Tıbbi testler ve görüşmeler"),
    "vestibular_rehab": ("Vestibular rehab", "Vestibüler rehabilitasyon"), "eva": ("Spacewalk (EVA)", "Uzay yürüyüşü (EVA)"),
    "rest": ("Rest", "Dinlenme"), "skipped": ("Skipped session (rest)", "Atlanan seans (dinlenme)"),
    "exercise": ("Exercise", "Egzersiz"),
}


def activity_label(a: dict) -> dict:
    if a["kind"] == "exercise" and a.get("device"):
        return device_label(a["device"])
    en, tr_ = ACTIVITY_LABEL.get(a["kind"], (a["kind"], a["kind"]))
    if a.get("overtime"):
        en, tr_ = f"{en} (overtime)", f"{tr_} (fazla mesai)"
    return {"label": en, "label_tr": tr_}


@router.get("/crew/{cid}/energy")
async def energy(cid: str, side: str = "crew", days: int = 14):
    _crew(cid)
    w = W()
    cfg = w.cfg
    v = View(cid, side)
    hist = w.db.all("SELECT day, kind, device, minutes, kcal FROM activities WHERE crew_id=? AND day<=? AND day>?",
                    (cid, v.last_day, v.last_day - max(1, min(60, days))))
    by_day: dict[int, dict] = defaultdict(lambda: defaultdict(float))
    for r in hist:
        key = r["device"] if r["kind"] == "exercise" and r["device"] else r["kind"]
        by_day[r["day"]][key] += r["kcal"]
    m = v.metrics(["kcal_out", "kcal_exercise", "energy_balance", "mass_kg", "kcal"])
    intake = {p["day"]: p["value"] for p in m["kcal"]["points"]}
    daily = [{"day": d, **{k: round(x) for k, x in parts.items()}, "total": round(sum(parts.values())),
              "intake": round(intake[d]) if d in intake else None} for d, parts in sorted(by_day.items())]
    yesterday = [r for r in w.db.all("SELECT * FROM activities WHERE crew_id=? AND day=? ORDER BY idx", (cid, v.last_day))]
    for a in yesterday:
        a.update(activity_label(a))
    out: dict[str, Any] = {
        "metrics": m, "daily": daily, "yesterday": yesterday, "alerts": alerts_for(v.ev, {"energy"}),
        "met_table": [{"kind": k, "met": x, **activity_label({"kind": k})} for k, x in cfg["energy"]["met"].items()],
        "model": {"ared_met": cfg["energy"]["ared_met"], "rehab_met": cfg["energy"]["rehab_met"],
                  "t2": cfg["energy"]["t2"], "cevis_gross_efficiency": cfg["energy"]["cevis_gross_efficiency"],
                  "kcal_per_l_o2": cfg["energy"]["kcal_per_l_o2"], "kcal_per_kg_body_mass": cfg["energy"]["kcal_per_kg_body_mass"],
                  "source": cfg["energy"]["source"], "verified": cfg["energy"]["verified"]},
        "view": v.info(), "clock": clock_payload(),
    }
    if not v.ground:
        today_ = w.energy_today(cid)
        for b in today_["blocks"]:
            b.update(activity_label(b))
        out["today"] = today_
    return out


MIND_METRICS = ["wellbeing", "feeling", "stress", "tiredness", "connection", "pvt_rt_ms", "pvt_lapses", "workload_h",
                "contact_week_min"]


@router.get("/crew/{cid}/mind")
async def mind(cid: str, side: str = "crew"):
    _crew(cid)
    w = W()
    v = View(cid, side)
    al = alerts_for(v.ev, {"mind"})
    tips = []
    for a in al:
        for r in a["recs"]:
            if r["id"] not in {t["id"] for t in tips}:
                tips.append(r)
    out: dict[str, Any] = {"metrics": v.metrics(MIND_METRICS), "alerts": al, "tips": tips, "view": v.info(),
                           "clock": clock_payload(), "link": w.link.status(),
                           "live_calls_possible": w.link.delay_s() <= w.cfg["schedule"]["live_call_max_delay_s"]}
    if not v.ground:
        entries = w.manual_today(cid)
        out["checkin_today"] = next((e["payload"] for e in reversed(entries) if e["kind"] == "checkin"), None)
        out["pvt_today"] = next((e["payload"] for e in reversed(entries) if e["kind"] == "pvt"), None)
        out["schedule"] = [{**b, **activity_label(b)} for b in w.schedule(cid)]
    return out


VEST_METRICS = ["vest_sot", "vest_tandem", "vest_dizzy", "ortho_hr_rise", "vest_readiness"]


@router.get("/crew/{cid}/return")
async def return_to_earth(cid: str, side: str = "crew"):
    prof = _crew(cid)
    w = W()
    cfg = w.cfg
    v = View(cid, side)
    m = v.metrics(VEST_METRICS)
    phase = phase_of(cfg, w.today if not v.ground else v.last_day + 1)
    sot = m["vest_sot"]
    base = sot.get("baseline_mean")
    lv = m["vest_readiness"]
    if phase == "postflight":
        level = int(lv["value"]) if lv.get("value") is not None and (lv.get("day") or -1) >= w.landing_day else 0
    else:
        level = None
    rec = balance_recovery([p["day"] for p in sot["points"]], [p["value"] for p in sot["points"]], w.landing_day, base)
    pred = w.landing_prediction(cid)
    vc = cfg["vestibular"]
    return {
        "phase": phase, "landing_day": w.landing_day, "today": w.today, "view": v.info(), "clock": clock_payload(),
        "days_to_landing": w.landing_day - w.today if phase != "postflight" else None,
        "r_day": (w.today if not v.ground else v.last_day) - w.landing_day if phase == "postflight" else None,
        "metrics": m, "readiness": level_info(cfg, level) if level is not None else None,
        "readiness_config": level_info(cfg, 0),
        "recovery": rec, "prediction": pred, "flights": prof.get("flights", 1),
        "baseline": {"vest_sot": base, "vest_tandem": m["vest_tandem"].get("baseline_mean"),
                     "ortho_hr_rise": m["ortho_hr_rise"].get("baseline_mean")},
        "alerts": alerts_for(v.ev, {"vestibular"}),
        "tasks": [t for t in v.tasks() if t.get("kind") in ("prelanding", "fluid", "vest_rehab", "dizziness", "workout")],
        "model": {k: vc[k] for k in ("sot_landing_drop", "tandem_landing_drop", "dizzy_landing", "training_benefit",
                                       "prelanding_training_days", "recovered_within_pct", "duration_ref_days")}
        | {"source": vc["source"], "verified": vc["verified"]},
        "susceptibility": prof["vestibular"]["susceptibility"], "tau_days": prof["vestibular"]["tau_days"],
    }


@router.get("/crew/{cid}/nutrition")
async def nutrition(cid: str, side: str = "crew"):
    _crew(cid)
    w = W()
    cfg = w.cfg
    v = View(cid, side)
    entries = w.manual_today(cid) if not v.ground else []
    totals: dict[str, float] = defaultdict(float)
    for e in entries:
        p = e["payload"]
        if e["kind"] == "food":
            for k in ("kcal", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu", "water_l"):
                totals[k] += p.get(k, 0)
        elif e["kind"] == "water":
            totals["water_l"] += p["liters"]
    tasks = w.tasks(cid)
    sup = []
    for p in v.ev["protocols"]:
        doses = w.db.all("SELECT day, taken, source FROM doses WHERE protocol_id=? AND day<=? ORDER BY day DESC LIMIT 14",
                         (p["protocol_id"], v.last_day))
        sup.append({"protocol_id": p["protocol_id"], "label": p["label"], "label_tr": p.get("label_tr"),
                    "dose_text": p["dose_text"], "dose_text_tr": p.get("dose_text_tr"), "status": p["status"],
                    "adherence": p["adherence"], "doses": doses[::-1], "start_day": p["start_day"],
                    "today_task": None if v.ground else next((t for t in tasks if t["task_id"] == f"supplement:{p['protocol_id']}"), None)})
    planned = sum(p["minutes"] for p in w.planned(cid))
    return {"today_entries": entries, "today_totals": totals, "targets": cfg["nutrition_targets"],
            "water_target_l": water_target(cfg, planned),
            "metrics": v.metrics(["kcal", "water_l", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu", "kcal_out", "energy_balance"]),
            "supplements": sup, "catalog": cfg["food_catalog"]["items"],
            "catalog_verified": cfg["food_catalog"]["verified"], "clock": clock_payload(), "view": v.info(),
            "water_task": next((t for t in tasks if t["task_id"] == "water"), None) if not v.ground else None}


@router.post("/crew/{cid}/manual")
async def manual(cid: str, body: dict = Body(...)):
    _crew(cid)
    kind = body.pop("kind", None)
    try:
        return W().add_manual(cid, kind, body)
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(400, f"bad entry: {e}")


@router.get("/crew/{cid}/lab")
async def lab(cid: str, side: str = "crew"):
    _crew(cid)
    w = W()
    v = View(cid, side)
    ev = v.ev
    urine = v.metrics(mids_in("urine") + ["ared_week_min"])
    lab_alerts = [a for a in alerts_for(ev, {"urine"})] + [a for a in ev["alerts"] if a["kind"] == "protocol"]
    bone_rule = next((a for a in ev["alerts"] if a["id"] == "bone_loss"), None)
    stone_rule = next((a for a in ev["alerts"] if a["id"] == "stone_risk"), None)
    pending = next((t for t in v.tasks() if t.get("kind") == "supplement_start"
                    or str(t.get("task_id", "")).startswith("supplement_start")), None)
    return {"metrics": urine, "alerts": lab_alerts, "protocols": ev["protocols"], "bone_alert": bone_rule,
            "stone_alert": stone_rule, "pending_protocol_task": pending,
            "stone_threshold": {"value": 2.0, "source": "https://ntrs.nasa.gov/citations/20090019087", "verified": True},
            "volume_thresholds": {"risk_below": 2.0, "lowest_above": 2.5, "source": "https://ntrs.nasa.gov/citations/20000084164", "verified": True},
            "clock": clock_payload(), "view": v.info()}


@router.get("/crew/{cid}/environment")
async def environment(cid: str, side: str = "crew"):
    _crew(cid)
    w = W()
    v = View(cid, side)
    m = w.cfg["model"]
    return {"metrics": v.metrics(["co2_mmhg", "rad_msv", "rad_cum"]), "live": v.live(),
            "profile": w.link.profile, "dose_rate_msv_day": m["radiation_msv_per_day"].get(w.link.profile),
            "dose_rate_verified": m["verified"], "view": v.info(),
            "events": [e for e in w.events_for(cid) if e["kind"] in ("co2_spike", "solar_particle_event")]}


@router.get("/devices")
async def devices(crew: str = "c1"):
    _crew(crew)
    w = W()
    now = w.real()
    out = []
    for a in w.adapters:
        st = a.status(crew, w.mission_t, now)
        out.append({**a.info(), "status": {"connected": st.connected, "state": st.state, "battery_pct": st.battery_pct,
                                           "last_sync_mission_t": st.last_sync_mission_t, "note": st.note,
                                           "note_tr": st.note_tr or None}})
    return {"devices": out, "clock": clock_payload()}


@router.post("/devices/{device_id}/toggle")
async def device_toggle(device_id: str):
    w = W()
    a = w.adapter_by_id.get(device_id)
    if a is None or device_id in ("manual", "csv"):
        raise HTTPException(404, "unknown device")
    a.enabled = not a.enabled
    w.log(None, "device", "warn" if not a.enabled else "info", f"{a.name} {'disabled' if not a.enabled else 'enabled'}",
          f"{a.name_tr or a.name} {'devre dışı' if not a.enabled else 'etkin'}")
    return {"id": device_id, "enabled": a.enabled}


@router.post("/import/csv")
async def import_csv(request: Request):
    text = (await request.body()).decode("utf-8", errors="replace")
    if len(text) > 2_000_000:
        raise HTTPException(413, "file too large")
    return W().import_csv(text)


# ------------------------------------------------------------------ LSAH
LSAH_METRICS = ["bmd_hip", "vo2peak", "vitd_serum", "hemoglobin"]


@router.get("/lsah")
async def lsah_catalog():
    cfg = W().cfg
    ls = cfg["lsah"]
    return {"source": ls["source"], "verified": ls["verified"], "catalog": ls["catalog"],
            "annual_exam": {k: ls["annual_exam"][k] for k in ("source", "verified", "note", "note_tr", "items")},
            "mission_tests": {"source": ls["mission_tests"]["source"], "verified": ls["mission_tests"]["verified"],
                              "tests": [{**t, "all_days": test_days(cfg, t)} for t in ls["mission_tests"]["tests"]]}}


@router.get("/crew/{cid}/lsah")
async def crew_lsah(cid: str, side: str = "crew"):
    prof = _crew(cid)
    w = W()
    cfg = w.cfg
    v = View(cid, side)
    ref_day = v.last_day if v.ground else w.today
    today = mission_date(cfg, w.today)
    cat = {c["id"]: c for c in cfg["lsah"]["catalog"]}
    tasks = {t["task_id"]: t for t in w.tasks(cid)} if not v.ground else {}
    tests = []
    for t in cfg["lsah"]["mission_tests"]["tests"]:
        sessions = []
        for d in test_days(cfg, t):
            res = {m: dict(zip(*v.series[m])).get(d) for m in t["metrics"] if m in v.series}
            if any(x is not None for x in res.values()):
                status = "done"
            elif d == w.today and not v.ground:
                status = "today_done" if tasks.get(f"lsah:{t['id']}", {}).get("status") == "done" else "today"
            elif d <= ref_day:
                status = "missed"
            else:
                status = "planned"
            sessions.append({"day": d, "date": mission_date(cfg, d).isoformat(), "status": status, "results": res})
        nxt = next((s for s in sessions if s["status"] in ("today", "today_done", "planned")), None)
        c = cat.get(t["category_id"], {})
        tests.append({"id": t["id"], "label": t["label"], "label_tr": t.get("label_tr"), "detail": t.get("detail"),
                      "detail_tr": t.get("detail_tr"), "metrics": t["metrics"], "category_id": t["category_id"],
                      "category": c.get("title"), "category_tr": c.get("title_tr"), "mrid": c.get("mrid"),
                      "sessions": sessions, "next": nxt})
    return {"profile": {"name": prof["name"], "role": prof["role"], "role_tr": prof.get("role_tr"), "sex": prof.get("sex"),
                        "birth": prof.get("birth"), "age": age_on(prof["birth"], today), "flights": prof.get("flights"),
                        "last_dxa_year": prof.get("last_dxa_year")},
            "annual": annual_plan(cfg, prof, today), "tests": tests, "metrics": v.metrics(LSAH_METRICS),
            "alerts": alerts_for(v.ev, {"lsah"}), "dates": {"today": today.isoformat(),
                                                           "launch": mission_date(cfg, 0).isoformat(),
                                                           "landing": mission_date(cfg, w.landing_day).isoformat()},
            "source": cfg["lsah"]["source"],
            "schedule": {"source": cfg["lsah"]["mission_tests"]["source"], "verified": cfg["lsah"]["mission_tests"]["verified"]},
            "view": v.info(), "clock": clock_payload()}


# --------------------------------------------------------------- surgeon
def _ground_series(cid: str) -> dict:
    return W().db.series(cid, table="g_samples")


@router.get("/surgeon/overview")
async def surgeon_overview():
    w = W()
    now = w.real()
    crew = []
    for c in w.crew:
        row = w.db.one("SELECT * FROM g_state WHERE crew_id=?", (c["id"],))
        last_day = w.db.one("SELECT MAX(day) d FROM g_samples WHERE crew_id=?", (c["id"],))
        item = {"id": c["id"], "name": c["name"], "role": c["role"], "role_tr": c.get("role_tr"), "state": None,
                "ground_last_day": last_day["d"] if last_day else None}
        if row:
            item.update({"state": json.loads(row["payload"]), "data_mission_t": row["mission_t"],
                         "data_age_s": now - row["created_real"], "received_age_s": now - row["received_real"],
                         "seq": row["seq"]})
        crew.append(item)
    return {"crew": crew, "link": w.link.status(), "onboard_clock": clock_payload()}


@router.get("/surgeon/crew/{cid}/series")
async def surgeon_series(cid: str, metrics: str = "u_volume,caox_ss,u_calcium,hr_rest,sleep_h"):
    _crew(cid)
    series = _ground_series(cid)
    today = max((d[-1] for d, _ in series.values() if d), default=0)
    mids = [m for m in metrics.split(",") if m in W().cfg["metrics"]]
    return {"metrics": {m: metric_payload(series, m, today) for m in mids}, "ground_last_day": today}


DEFAULT_CORR = ["water_l", "u_volume", "u_sg", "caox_ss", "ex_total_min", "ared_week_min", "u_calcium",
                "sleep_h", "hr_rest", "pvt_rt_ms", "stress", "workload_h", "core_temp", "co2_mmhg", "kcal", "kcal_out",
                "feeling"]


@router.get("/surgeon/correlations")
async def surgeon_correlations(crew: str = "all", metrics: str = ",".join(DEFAULT_CORR), x: str | None = None,
                               y: str | None = None):
    w = W()
    mids = [m for m in metrics.split(",") if m in w.cfg["metrics"]]
    crews = w.crew_ids if crew == "all" else [crew]
    by_key: dict[tuple[str, int], dict[str, float]] = defaultdict(dict)
    for cid in crews:
        for m, (days, vals) in _ground_series(cid).items():
            if m in mids or m in (x, y):
                for d, val in zip(days, vals):
                    if 0 <= d < w.landing_day:
                        by_key[(cid, d)][m] = val
    matrix = []
    for a in mids:
        row = []
        for b in mids:
            pairs = [(r[a], r[b]) for r in by_key.values() if a in r and b in r]
            r = pearson([p[0] for p in pairs], [p[1] for p in pairs]) if len(pairs) >= 5 else None
            row.append(None if r is None else round(r, 2))
        matrix.append(row)
    scatter = None
    if x in w.cfg["metrics"] and y in w.cfg["metrics"]:
        scatter = [{"crew_id": k[0], "day": k[1], "x": r[x], "y": r[y]} for k, r in by_key.items() if x in r and y in r]
    lang = LANG.get()
    labels = {m: (w.cfg["metrics"][m].get("label_tr") if lang == "tr" else None) or w.cfg["metrics"][m]["label"]
              for m in set(mids) | {x, y} if m in w.cfg["metrics"]}
    return {"metrics": mids, "labels": labels, "matrix": matrix, "n_days": len(by_key), "scatter": scatter, "x": x, "y": y}


@router.get("/surgeon/events")
async def surgeon_events(limit: int = 120):
    w = W()
    now = w.real()
    rows = w.db.all("SELECT * FROM g_event_log ORDER BY seq DESC LIMIT ?", (limit,))
    names = {c["id"]: c["name"] for c in w.crew}
    for r in rows:
        r["crew_name"] = names.get(r["crew_id"], tr("Mission", "Görev"))
        r["age_s"] = now - r["created_real"]
        r["transit_s"] = r["received_real"] - r["created_real"]
    return {"events": rows}


@router.get("/link")
async def link_status():
    w = W()
    return {"status": w.link.status(), "packets": w.link.recent_packets(40)}


# ------------------------------------------------------------------ demo
@router.post("/demo/profile")
async def demo_profile(body: dict = Body(...)):
    try:
        W().link.set_profile(body["profile"], body.get("delay_s"))
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
    return W().link.status()


@router.post("/demo/speed")
async def demo_speed(body: dict = Body(...)):
    W().set_speed(float(body.get("day_seconds", 60)))
    return clock_payload()


@router.post("/demo/skip")
async def demo_skip(body: dict = Body(...)):
    days = max(0.0, min(30.0, float(body.get("days", 1))))
    w = W()
    w.advance(days)
    w.send_snapshots()
    return clock_payload()


@router.post("/demo/jump")
async def demo_jump(body: dict = Body(...)):
    """Fast-forward to a day relative to landing: {"r_day": -14 | 0 | 1 | 3 | 7 ...}."""
    w = W()
    r = int(body.get("r_day", 0))
    day = w.landing_day + r
    if day <= w.today:
        raise HTTPException(409, "that day is already past (the clock only runs forward; reset to start over)")
    w.jump_to(day, float(body.get("hour", 8.0)))
    return clock_payload()


@router.post("/demo/inject")
async def demo_inject(body: dict = Body(...)):
    try:
        return W().inject_event(body["crew_id"], body["kind"], body.get("days"))
    except KeyError as e:
        raise HTTPException(400, f"unknown {e}")


@router.post("/demo/autopilot")
async def demo_autopilot(body: dict = Body(...)):
    cid = body.get("crew_id", "")
    _crew(cid)
    W().autopilot[cid] = bool(body.get("on", True))
    return {"crew_id": cid, "autopilot": W().autopilot[cid]}


@router.get("/demo/autopilot")
async def demo_autopilot_get():
    return W().autopilot


@router.post("/demo/blackout")
async def demo_blackout(body: dict = Body(...)):
    W().link.forced_blackout = bool(body.get("on"))
    return W().link.status()


@router.post("/demo/reset")
async def demo_reset(body: dict = Body(default={})):
    assert STATE is not None
    seed = body.get("seed")
    STATE.reset(int(seed) if seed not in (None, "") else None)
    return clock_payload()


@router.get("/demo/events")
async def demo_events():
    return {"events": W().events_for()}


# --------------------------------------------------------------- sources
@router.get("/sources")
async def sources():
    cfg = W().cfg
    thresholds = []
    for mid, m in cfg["metrics"].items():
        for r in m.get("rules", []):
            thresholds.append({"metric": mid, "label": m["label"], "label_tr": m.get("label_tr"), "rule": f"{r['type']} {r['value']}",
                               "level": r["level"], "unit": m.get("unit", ""), "unit_tr": m.get("unit_tr"),
                               "source": r["source"], "verified": r["verified"], "phases": r.get("phases")})
    return {"references": cfg["references"], "thresholds": thresholds,
            "cross_rules": [{"id": r["id"], "title": r["title"], "title_tr": r.get("title_tr"), "level": r["level"],
                             "when": r["when"], "phases": r.get("phases"), "source": r["source"], "verified": r["verified"]}
                            for r in cfg["cross_rules"]],
            "recommendations": [{"id": k, **v} for k, v in cfg["recommendations"].items()],
            "protocols": {k: {"label": v["label"], "label_tr": v.get("label_tr"), "dose_text": v["dose_text"],
                              "dose_text_tr": v.get("dose_text_tr"), "targets": v["targets"],
                              "source": v["source"], "verified": v["verified"]} for k, v in cfg["protocols"].items()},
            "unverified": unverified_items(cfg), "disclaimer": cfg["meta"]["disclaimer"],
            "disclaimer_tr": cfg["meta"].get("disclaimer_tr")}


@router.get("/osdr")
async def osdr_studies(refresh: bool = False):
    return await run_in_threadpool(osdr.related_studies, refresh)


# ------------------------------------------------------------- websocket
@ws_router.websocket("/ws/crew/{cid}/workout")
async def ws_workout(ws: WebSocket, cid: str):
    await ws.accept()
    lang = LANG.get()
    try:
        while True:
            w = W()
            if cid not in w.profiles:
                await ws.close(code=4404)
                return
            await ws.send_json(localize({**w.workout_view(cid), "clock": clock_payload()}, lang))
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, RuntimeError):
        return

