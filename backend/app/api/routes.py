"""HTTP + WebSocket API.

/api/crew/...     crew tablet app - reads the ONBOARD database only.
/api/surgeon/...  flight-surgeon view - reads the GROUND tables only (link-delayed).
/api/demo/...     demo controls (mission profile, clock speed, events).
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from ..config import unverified_items
from ..engine.rules import evaluate_metric
from ..engine.stats import ewma, pearson
from ..services import osdr
from ..sim.model import planned_sessions, water_target
from ..state import AppState

router = APIRouter(prefix="/api")
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
    return {"metric": mid, "label": m["label"], "unit": m.get("unit", ""), "decimals": m.get("decimals", 1),
            "group": m.get("group"), "device": m.get("device"), "meaning": m.get("meaning", ""),
            "direction": m.get("direction"), "thresholds": rules, "verified": verified,
            "estimate_note": m.get("estimate_note"), "has_rules": bool(rules)}


def metric_payload(series: dict, mid: str, today: int, ev: dict | None = None) -> dict:
    cfg = W().cfg
    info = metric_info(mid)
    days, vals = series.get(mid, ([], []))
    if ev is None and vals:
        ev = evaluate_metric(mid, cfg["metrics"][mid], days, vals, cfg["defaults"], today)
    alpha = cfg["metrics"][mid].get("ewma_alpha", cfg["defaults"]["ewma_alpha"])
    sm = ewma(vals, alpha) if vals else []
    points = [{"day": d, "value": v, "ewma": s} for d, v, s in zip(days, vals, sm)]
    out = {**info, "points": points}
    if ev:
        out.update({k: ev[k] for k in ("value", "ewma", "baseline_mean", "baseline_sd", "z", "pct", "slope",
                                       "anomaly", "status", "triggered", "day", "stale")})
    else:
        out.update({"value": None, "ewma": None, "status": "green", "triggered": [], "baseline_mean": None})
    return out


def metrics_payload(cid: str, mids: list[str]) -> dict[str, dict]:
    w = W()
    ev = w.evaluation(cid)
    series = w.db.series(cid, max_day=w.last_closed_day)
    return {m: metric_payload(series, m, w.last_closed_day, ev["metrics"].get(m)) for m in mids}


def mids_in(group: str) -> list[str]:
    return [m for m, d in W().cfg["metrics"].items() if d.get("group") == group]


def clock_payload() -> dict:
    w = W()
    frac = w.mission_t - w.today
    return {"mission_t": w.mission_t, "today": w.today, "hour": frac * 24, "day_seconds": w.day_seconds,
            "phase": "preflight" if w.today < 0 else "mission", "mission_days": w.last_day + 1,
            "day_seconds_options": w.cfg["simulation"]["day_seconds_options"], "seed": w.seed,
            "finished": w.mission_t >= w.last_day + 1 - 1e-5}


def live_now(cid: str) -> dict:
    w = W()
    out: dict[str, Any] = {}
    for aid in ("biomonitor", "tmini", "co2"):
        out.update(w.adapter_by_id[aid].live(cid, w.mission_t, w))
    return out


# ------------------------------------------------------------------ meta
@router.get("/meta")
async def meta():
    w = W()
    cfg = w.cfg
    return {"app_name": cfg["meta"]["app_name"], "disclaimer": cfg["meta"]["disclaimer"],
            "crew": [{"id": c["id"], "name": c["name"], "role": c["role"]} for c in w.crew],
            "clock": clock_payload(), "link": w.link.status(),
            "profiles": {k: {"label": v["label"], "delay_s": v["delay_s"], "delay_min_s": v.get("delay_min_s", v["delay_s"]),
                             "delay_max_s": v.get("delay_max_s", v["delay_s"]), "verified": v["verified"]}
                         for k, v in cfg["link"]["profiles"].items()},
            "injectable_events": {k: {"label": v["label"], "days": v["days"]} for k, v in cfg["injectable_events"].items()},
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
    ev = w.evaluation(cid)
    m = ev["metrics"]
    sleep = {k: metric_payload({}, k, w.last_closed_day, m.get(k)) for k in ("sleep_h", "sleep_quality")}
    for v in sleep.values():
        v.pop("points", None)
    planned = sum(p["minutes"] for p in planned_sessions(w.cfg, w.today))
    return {"crew": {"id": cid, "name": prof["name"], "role": prof["role"]}, "clock": clock_payload(),
            "overall": ev["overall"], "alerts": ev["alerts"], "tasks": w.tasks(cid),
            "sleep": sleep, "water_target_l": water_target(w.cfg, planned),
            "protocols": [{k: p[k] for k in ("protocol_id", "label", "score", "days_since_start", "days_to_target_left", "dose_text")}
                          for p in ev["protocols"] if p["status"] == "active"],
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
async def alerts(cid: str):
    _crew(cid)
    ev = W().evaluation(cid)
    return {"overall": ev["overall"], "alerts": ev["alerts"], "day": ev["today"]}


@router.get("/crew/{cid}/live")
async def live(cid: str):
    _crew(cid)
    return {"clock": clock_payload(), "live": live_now(cid)}


@router.get("/crew/{cid}/body")
async def body(cid: str):
    _crew(cid)
    vit = [m for m in mids_in("vitals")]
    return {"live": live_now(cid), "vitals": metrics_payload(cid, vit), "sleep": metrics_payload(cid, mids_in("sleep")),
            "clock": clock_payload()}


@router.get("/crew/{cid}/exercise")
async def exercise(cid: str):
    prof = _crew(cid)
    w = W()
    cfg = w.cfg
    rows = w.db.all("SELECT * FROM workouts WHERE crew_id=? ORDER BY day, id", (cid,))
    weeks: dict[int, dict] = defaultdict(lambda: {"ared": 0.0, "t2": 0.0, "cevis": 0.0})
    strength: dict[str, list] = defaultdict(list)
    sessions = []
    for r in rows:
        det = json.loads(r["details"] or "{}")
        wk = r["day"] // 7
        weeks[wk][r["device"]] += r["minutes"]
        for e in det.get("exercises", []):
            strength[e["exercise"]].append({"day": r["day"], "load_kg": e["load_kg"]})
        sessions.append({"id": r["id"], "day": r["day"], "device": r["device"], "minutes": r["minutes"],
                         "avg_hr": r["avg_hr"], "max_hr": r["max_hr"], "details": det, "source": r["source"]})
    week_list = [{"week": k, "label": f"W{k}" if k >= 0 else f"Pre{k}", **{d: round(v) for d, v in weeks[k].items()},
                  "total": round(sum(weeks[k].values()))} for k in sorted(weeks)]
    strength_out = {}
    for ex, pts in strength.items():
        best: dict[int, float] = {}
        for p in pts:
            best[p["day"]] = max(best.get(p["day"], 0), p["load_kg"])
        strength_out[ex] = [{"day": d, "load_kg": v} for d, v in sorted(best.items())]
    today_minutes = sum(s["minutes"] for s in sessions if s["day"] == w.today)
    last7 = sum(s["minutes"] for s in sessions if w.today - 6 <= s["day"] <= w.today)
    pres = cfg["prescription"]
    return {
        "today": [{**p, "label": {"ared": "ARED", "t2": "T2 treadmill", "cevis": "CEVIS cycle"}[p["device"]]}
                  for p in planned_sessions(cfg, w.today)],
        "tasks": [t for t in w.tasks(cid) if t["kind"] == "workout"],
        "weekly_target_min": pres["weekly_target_min"], "weekly_range_min": pres["weekly_range_min"],
        "last7_min": round(last7), "today_min": round(today_minutes), "weeks": week_list,
        "strength": strength_out, "sessions": sessions[-12:][::-1],
        "trends": metrics_payload(cid, ["ex_week_min", "ared_squat_kg", "t2_speed_kmh", "cevis_watts", "hr_exercise"]),
        "limits": {"ared_peak_load_kg": cfg["limits"]["ared_peak_load_kg"], "t2_peak_speed_kmh": cfg["limits"]["t2_peak_speed_kmh"],
                   "cevis_max_watts": cfg["cevis_limits"]["max_watts"], "source": cfg["limits"]["source"]},
        "ared_exercises": pres["ared_exercises"],
        "defaults": {"ared_load_kg": round(prof["ared_squat_kg"] * w.state[cid].strength),
                     "t2_speed_kmh": round(prof["t2_speed_kmh"] * w.state[cid].fitness, 1),
                     "harness_kg": round(prof["mass_kg"] * 0.7), "cevis_watts": round(prof["cevis_watts"] * w.state[cid].fitness)},
        "workout": w.workout_view(cid), "hr_rest": prof["hr_rest"],
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


@router.get("/crew/{cid}/nutrition")
async def nutrition(cid: str):
    _crew(cid)
    w = W()
    cfg = w.cfg
    entries = w.manual_today(cid)
    totals = defaultdict(float)
    for e in entries:
        p = e["payload"]
        if e["kind"] == "food":
            for k in ("kcal", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu", "water_l"):
                totals[k] += p.get(k, 0)
        elif e["kind"] == "water":
            totals["water_l"] += p["liters"]
    ev = w.evaluation(cid)
    sup = []
    for p in ev["protocols"]:
        doses = w.db.all("SELECT day, taken, source FROM doses WHERE protocol_id=? ORDER BY day DESC LIMIT 14", (p["protocol_id"],))
        sup.append({"protocol_id": p["protocol_id"], "label": p["label"], "dose_text": p["dose_text"], "status": p["status"],
                    "adherence": p["adherence"], "doses": doses[::-1], "start_day": p["start_day"],
                    "today_task": next((t for t in w.tasks(cid) if t["task_id"] == f"supplement:{p['protocol_id']}"), None)})
    planned = sum(p["minutes"] for p in planned_sessions(cfg, w.today))
    return {"today_entries": entries, "today_totals": totals, "targets": cfg["nutrition_targets"],
            "water_target_l": water_target(cfg, planned),
            "metrics": metrics_payload(cid, ["kcal", "water_l", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu", "feeling"]),
            "supplements": sup, "catalog": cfg["food_catalog"]["items"],
            "catalog_verified": cfg["food_catalog"]["verified"], "clock": clock_payload()}


@router.post("/crew/{cid}/manual")
async def manual(cid: str, body: dict = Body(...)):
    _crew(cid)
    kind = body.pop("kind", None)
    try:
        return W().add_manual(cid, kind, body)
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(400, f"bad entry: {e}")


@router.get("/crew/{cid}/lab")
async def lab(cid: str):
    _crew(cid)
    w = W()
    ev = w.evaluation(cid)
    urine = metrics_payload(cid, mids_in("urine") + ["ared_week_min"])
    lab_alerts = [a for a in ev["alerts"] if any(w.cfg["metrics"][m].get("group") == "urine" for m in a["metrics"])
                  or a["kind"] == "protocol"]
    bone_rule = next((a for a in ev["alerts"] if a["id"] == "bone_loss"), None)
    stone_rule = next((a for a in ev["alerts"] if a["id"] == "stone_risk"), None)
    pending = next((t for t in w.tasks(cid) if t["kind"] == "supplement_start"), None)
    return {"metrics": urine, "alerts": lab_alerts, "protocols": ev["protocols"], "bone_alert": bone_rule,
            "stone_alert": stone_rule, "pending_protocol_task": pending,
            "stone_threshold": {"value": 2.0, "source": "https://ntrs.nasa.gov/citations/20090019087", "verified": True},
            "volume_thresholds": {"risk_below": 2.0, "lowest_above": 2.5, "source": "https://ntrs.nasa.gov/citations/20000084164", "verified": True},
            "clock": clock_payload()}


@router.get("/crew/{cid}/environment")
async def environment(cid: str):
    _crew(cid)
    w = W()
    m = w.cfg["model"]
    return {"metrics": metrics_payload(cid, ["co2_mmhg", "rad_msv", "rad_cum"]), "live": live_now(cid),
            "profile": w.link.profile, "dose_rate_msv_day": m["radiation_msv_per_day"].get(w.link.profile),
            "dose_rate_verified": m["verified"], "events": [e for e in w.events_for(cid) if e["kind"] in ("co2_spike", "solar_particle_event")]}


@router.get("/devices")
async def devices(crew: str = "c1"):
    _crew(crew)
    w = W()
    now = w.real()
    out = []
    for a in w.adapters:
        st = a.status(crew, w.mission_t, now)
        out.append({**a.info(), "status": {"connected": st.connected, "state": st.state, "battery_pct": st.battery_pct,
                                           "last_sync_mission_t": st.last_sync_mission_t, "note": st.note}})
    return {"devices": out, "clock": clock_payload()}


@router.post("/devices/{device_id}/toggle")
async def device_toggle(device_id: str):
    w = W()
    a = w.adapter_by_id.get(device_id)
    if a is None or device_id in ("manual", "csv"):
        raise HTTPException(404, "unknown device")
    a.enabled = not a.enabled
    w.log(None, "device", "warn" if not a.enabled else "info", f"{a.name} {'disabled' if not a.enabled else 'enabled'}")
    return {"id": device_id, "enabled": a.enabled}


@router.post("/import/csv")
async def import_csv(request: Request):
    text = (await request.body()).decode("utf-8", errors="replace")
    if len(text) > 2_000_000:
        raise HTTPException(413, "file too large")
    return W().import_csv(text)


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
        item = {"id": c["id"], "name": c["name"], "role": c["role"], "state": None,
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
                "sleep_h", "hr_rest", "core_temp", "co2_mmhg", "kcal", "feeling"]


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
                for d, v in zip(days, vals):
                    if d >= 0:
                        by_key[(cid, d)][m] = v
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
    return {"metrics": mids, "labels": {m: w.cfg["metrics"][m]["label"] for m in mids}, "matrix": matrix,
            "n_days": len(by_key), "scatter": scatter, "x": x, "y": y}


@router.get("/surgeon/events")
async def surgeon_events(limit: int = 120):
    w = W()
    now = w.real()
    rows = w.db.all("SELECT * FROM g_event_log ORDER BY seq DESC LIMIT ?", (limit,))
    names = {c["id"]: c["name"] for c in w.crew}
    for r in rows:
        r["crew_name"] = names.get(r["crew_id"], "Mission")
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
            thresholds.append({"metric": mid, "label": m["label"], "rule": f"{r['type']} {r['value']}", "level": r["level"],
                               "unit": m.get("unit", ""), "source": r["source"], "verified": r["verified"]})
    return {"references": cfg["references"], "thresholds": thresholds,
            "cross_rules": [{"id": r["id"], "title": r["title"], "level": r["level"], "when": r["when"],
                             "source": r["source"], "verified": r["verified"]} for r in cfg["cross_rules"]],
            "recommendations": [{"id": k, **v} for k, v in cfg["recommendations"].items()],
            "protocols": {k: {"label": v["label"], "dose_text": v["dose_text"], "targets": v["targets"],
                              "source": v["source"], "verified": v["verified"]} for k, v in cfg["protocols"].items()},
            "unverified": unverified_items(cfg), "disclaimer": cfg["meta"]["disclaimer"]}


@router.get("/osdr")
async def osdr_studies(refresh: bool = False):
    return await run_in_threadpool(osdr.related_studies, refresh)


# ------------------------------------------------------------- websocket
@ws_router.websocket("/ws/crew/{cid}/workout")
async def ws_workout(ws: WebSocket, cid: str):
    await ws.accept()
    try:
        while True:
            w = W()
            if cid not in w.profiles:
                await ws.close(code=4404)
                return
            await ws.send_json({**w.workout_view(cid), "clock": clock_payload()})
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, RuntimeError):
        return
