"""Coupled physiology 'truth' model for one crew member and one day.

Sources affect each other:
  * exercise -> exercise heart rate, sweat losses (lower urine volume), core temperature,
    a higher water target, burned energy and mood/stress;
  * water intake -> urine volume -> specific gravity and stone-risk supersaturation;
  * resistance exercise (ARED) -> how much urine calcium rises (bone loss);
  * protocols -> later urine samples, scaled by adherence (an EWMA of doses taken) and
    a per-person response factor;
  * sleep -> next resting heart rate, how the crew member feels, tiredness and reaction time;
  * the day schedule -> energy burned, workload and stress; live calls -> feeling connected;
  * energy eaten minus burned -> body mass;
  * flight length, pre-landing training and fitness -> balance and dizziness after landing.

Randomness is drawn from per-(seed, crew, day, stream) generators, so the same seed
and the same user actions always give the same data, independent of request order.
All coefficients live in config `model`, `energy`, `schedule`, `mind` and `vestibular`
(marked unverified).
"""
from __future__ import annotations

import hashlib
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..config import phase_of
from ..engine.lsah import tests_on


def rng_for(seed: int, crew_idx: int, day: int, stream: str) -> np.random.Generator:
    h = int(hashlib.blake2s(stream.encode(), digest_size=4).hexdigest(), 16)
    return np.random.default_rng([seed, crew_idx, day + 10_000, h])


def adaptation(day: int, tau: float, mission_days: int | None = None, tau_back: float = 12.0) -> float:
    """0 on the ground before launch, rising toward 1 in flight, fading after landing."""
    if day < 0:
        return 0.0
    if mission_days is not None and day >= mission_days:
        a_land = 1.0 - math.exp(-mission_days / tau)
        return a_land * math.exp(-(day - mission_days + 1) / tau_back)
    return 1.0 - math.exp(-(day + 1) / tau)


def caox_supersaturation(ca_mg: float, ox_mg: float, cit_mg: float, ph: float, vol_l: float) -> float:
    """Simplified calcium-oxalate relative supersaturation estimate (NOT EQUIL2).

    Ion-activity-like product of calcium and oxalate concentrations, reduced by citrate
    (which binds calcium) and slightly by higher pH. Calibrated so typical preflight
    values sit around 1.2-1.6 and dehydrated in-flight values exceed 2.0.
    """
    vol = max(vol_l, 0.3)
    ca = ca_mg / 40.08 / vol
    ox = ox_mg / 88.02 / vol
    cit = cit_mg / 189.1 / vol
    return 6.0 * ca * ox / (1.0 + 0.55 * cit) * (1.0 + 0.12 * (6.2 - ph))


@dataclass
class CrewState:
    """Slow variables carried from day to day."""
    ared_7: deque = field(default_factory=lambda: deque(maxlen=7))
    ex_7: deque = field(default_factory=lambda: deque(maxlen=7))
    contact_7: deque = field(default_factory=lambda: deque(maxlen=7))
    bone_deficit: float = 0.0           # EWMA of (1 - ARED minutes / plan)
    strength: float = 1.0               # multiplies ARED loads
    fitness: float = 1.0                # multiplies T2 speed / CEVIS watts
    adherence: dict = field(default_factory=dict)   # protocol_id -> EWMA of doses
    rad_cum: float = 0.0
    last_sleep_h: float | None = None
    mass: float | None = None           # true body mass (kg), driven by energy balance
    prelanding_days: int = 0            # pre-landing training sessions done
    vest_rehab_days: int = 0            # post-flight vestibular rehab sessions done
    landing: dict | None = None         # landing-day effects, fixed when the crew lands
    bmd_frac: float = 1.0               # hip bone density as a share of the preflight value
    vitd: float | None = None           # serum 25-OH vitamin D (ng/mL)


@dataclass
class DayInputs:
    """Everything outside the body that shapes one day."""
    autopilot: bool = True
    user_workouts: list[dict] = field(default_factory=list)   # logged by the crew member
    workout_tasks_done: set = field(default_factory=set)       # {'ared', 'cardio', 'rehab'} quick confirms
    water_task_done: bool = False
    water_extra_l: float = 0.0
    food_entries: list[dict] = field(default_factory=list)
    feeling: float | None = None
    checkin: dict | None = None                                # {feeling, stress, tiredness, connection}
    pvt: dict | None = None                                    # {mean_rt_ms, lapses}
    dizziness: float | None = None
    prelanding_done: bool = False
    vest_rehab_done: bool = False
    lsah_done: set = field(default_factory=set)                # LSAH tests performed today (ids)
    protocols: list[dict] = field(default_factory=list)        # active: {id, type, start_day}
    doses_confirmed: set = field(default_factory=set)          # protocol ids confirmed today
    events: list[dict] = field(default_factory=list)           # active events with params
    profile: str = "iss"
    link_delay_s: float = 0.5


def water_target(cfg: dict, planned_ex_min: float) -> float:
    m = cfg["model"]
    return round(m["water_target_base_l"] + m["water_target_per_ex_hour_l"] * planned_ex_min / 60.0, 2)


def landing_day(cfg: dict) -> int:
    return int(cfg["simulation"]["mission_days"])


def planned_sessions(cfg: dict, day: int, eva: bool = False) -> list[dict]:
    p = cfg["prescription"]
    if phase_of(cfg, day) == "postflight":
        if day == landing_day(cfg):
            return []                    # landing day: rest
        return [{"slot": "rehab", "device": "rehab", "minutes": p["rehab_min"]}]
    cardio = "t2" if day % 2 == 0 else "cevis"
    out = [] if eva else [{"slot": "ared", "device": "ared", "minutes": p["ared_min"]}]
    out.append({"slot": "cardio", "device": cardio, "minutes": p["cardio_min"]})
    return out


def slot_of(device: str) -> str:
    return "ared" if device == "ared" else "rehab" if device == "rehab" else "cardio"


def _event_params(events: list[dict]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for e in events:
        out[e["kind"]] = e.get("params", {})
    return out


# ---------------------------------------------------------------------- energy
def kcal_per_min(cfg: dict, device: str, s: dict, mass: float) -> float:
    """Energy cost (kcal/min) of an exercise session from the machine settings."""
    e = cfg["energy"]
    if device == "ared":
        lo, hi = e["ared_met"]
        frac = min(1.0, float(s.get("load_kg", mass)) / (2 * mass))
        return (lo + (hi - lo) * frac) * mass / 60.0
    if device == "t2":
        v = float(s.get("speed_kmh", 9.0)) * 1000.0 / 60.0                    # m/min
        load = max(0.3, min(1.0, float(s.get("harness_kg", 0.7 * mass)) / mass))
        vo2 = e["t2"]["resting_ml_kg_min"] + e["t2"]["ml_per_m"] * v * load   # ml/kg/min
        return vo2 * mass / 1000.0 * e["kcal_per_l_o2"]
    if device == "cevis":
        return float(s.get("watts", 150)) * 60.0 / 4186.0 / e["cevis_gross_efficiency"]
    if device == "rehab":
        return e["rehab_met"] * mass / 60.0
    return mass / 60.0


def session_settings(details: dict) -> dict:
    """Machine settings that set a logged session's intensity."""
    if details.get("exercises"):
        return {"load_kg": max(x["load_kg"] for x in details["exercises"])}
    return {k: details[k] for k in ("speed_kmh", "harness_kg", "watts") if k in details}


def session_kcal(cfg: dict, device: str, details: dict, minutes: float, mass: float) -> float:
    return kcal_per_min(cfg, device, session_settings(details), mass) * minutes


def day_schedule(cfg: dict, day: int, events: dict, link_delay_s: float, crew_idx: int) -> list[dict]:
    """The crew member's planned day as time blocks (crew time, hours)."""
    sc = cfg["schedule"]
    ph = phase_of(cfg, day)
    blocks = [dict(b) for b in (sc["postflight"] if ph == "postflight" else sc["inflight"])]
    if ph == "postflight" and day == landing_day(cfg):
        blocks = [{**b, "kind": "rest", "slot": None} if b["kind"] in ("exercise", "vestibular_rehab") else b for b in blocks]
    if ph == "inflight" and "eva" in events:
        s, e = sc["eva"]["start"], sc["eva"]["end"]
        out = []
        for b in blocks:
            if b["end"] <= s or b["start"] >= e:
                out.append(b)
                continue
            if b["start"] < s:
                out.append({**b, "end": s})
            if b["end"] > e:
                out.append({**b, "start": e})
        out.append({"kind": "eva", "start": s, "end": e})
        blocks = sorted(out, key=lambda b: b["start"])
    if "high_workload" in events:
        blocks = [{**b, "kind": "maintenance", "overtime": True} if b["kind"] == "leisure" else b for b in blocks]
    if (ph != "postflight" and "isolation" not in events and link_delay_s <= sc["live_call_max_delay_s"]
            and (day + crew_idx) % 7 == 0):
        out = []
        for b in blocks:
            if b["kind"] == "leisure":
                mid = b["start"] + sc["family_call_min"] / 60.0
                out += [{"kind": "family_call", "start": b["start"], "end": mid}, {**b, "start": mid}]
            else:
                out.append(b)
        blocks = out
    return blocks


def block_kcal(cfg: dict, kind: str, hours: float, mass: float) -> tuple[float, float]:
    met = cfg["energy"]["met"].get(kind, cfg["energy"]["met"]["rest"])
    return met, met * mass * hours


def day_activities(cfg: dict, blocks: list[dict], sessions: list[dict], mass: float) -> list[dict]:
    """Turn the schedule plus the sessions actually done into activities with energy cost."""
    by_slot: dict[str, list[dict]] = {}
    for s in sessions:
        by_slot.setdefault(slot_of(s["device"]), []).append(s)
    acts: list[dict] = []
    for b in blocks:
        hours = b["end"] - b["start"]
        if b["kind"] == "exercise":
            done = by_slot.pop(b.get("slot") or "", [])
            t = b["start"]
            for s in done:
                end = t + s["minutes"] / 60.0
                acts.append({"kind": "exercise", "device": s["device"], "slot": b["slot"], "start": t, "end": end,
                             "met": round(s["kcal"] / max(1e-6, s["minutes"] / 60.0) / mass, 1), "kcal": s["kcal"]})
                t = end
            if t < b["end"] - 1e-6:
                met, kc = block_kcal(cfg, "rest", b["end"] - t, mass)
                acts.append({"kind": "rest" if done else "skipped", "slot": b["slot"], "start": t, "end": b["end"],
                             "met": met, "kcal": kc})
        else:
            met, kc = block_kcal(cfg, b["kind"], hours, mass)
            acts.append({"kind": b["kind"], "start": b["start"], "end": b["end"], "met": met, "kcal": kc,
                         **({"overtime": True} if b.get("overtime") else {})})
    t = 19.5
    for ss in by_slot.values():           # sessions without a slot today (e.g. ARED on an EVA day)
        for s in ss:
            end = t + s["minutes"] / 60.0
            acts.append({"kind": "exercise", "device": s["device"], "slot": "extra", "start": t, "end": end,
                         "met": round(s["kcal"] / max(1e-6, s["minutes"] / 60.0) / mass, 1), "kcal": s["kcal"]})
            t = end
    for a in acts:
        a["minutes"] = round((a["end"] - a["start"]) * 60.0, 1)
        a["kcal"] = round(a["kcal"], 1)
    return acts


def work_hours(cfg: dict, blocks: list[dict]) -> float:
    kinds = set(cfg["schedule"]["work_kinds"])
    return sum(b["end"] - b["start"] for b in blocks if b["kind"] in kinds)


# ------------------------------------------------------------------ vestibular
def landing_effects(cfg: dict, prof: dict, training_days: float, fitness: float) -> dict:
    """Size of the balance/dizziness/orthostatic effects on landing day (R+0)."""
    vc = cfg["vestibular"]
    pv = prof["vestibular"]
    dur = math.sqrt(cfg["simulation"]["mission_days"] / vc["duration_ref_days"])
    train = min(1.0, training_days / vc["prelanding_training_days"])
    benefit = 1.0 - vc["training_benefit"] * train
    susc = pv["susceptibility"]
    sot_drop = min(0.8, vc["sot_landing_drop"] * dur * susc * benefit)
    return {"sot_drop": sot_drop, "tandem_drop": vc["tandem_landing_drop"] * dur * susc * benefit,
            "dizzy0": min(10.0, vc["dizzy_landing"] * susc * benefit),
            "ortho_rise": vc["ortho_landing_rise"] * dur * max(0.5, 2.0 - fitness), "training": train,
            "tau_days": pv["tau_days"],
            "days_to_baseline": recovery_days(sot_drop, pv["tau_days"], vc["recovered_within_pct"])}


def recovery_days(sot_drop: float, tau: float, within_pct: float) -> float:
    """Days until the balance score is back within `within_pct` % of baseline."""
    if sot_drop * 100 <= within_pct:
        return 0.0
    return tau * math.log(sot_drop * 100 / within_pct)


# -------------------------------------------------------------------- sessions
def session_details(cfg: dict, prof: dict, st: CrewState, device: str, minutes: float, rng) -> dict:
    lim = cfg["limits"]
    if device == "ared":
        squat = min(lim["ared_peak_load_kg"], prof["ared_squat_kg"] * st.strength)
        ex = [
            {"exercise": "squat", "load_kg": round(squat), "sets": 3, "reps": int(rng.integers(8, 11))},
            {"exercise": "deadlift", "load_kg": round(min(lim["ared_peak_load_kg"], squat * 1.1)), "sets": 3, "reps": int(rng.integers(6, 9))},
            {"exercise": "heel raise", "load_kg": round(min(lim["ared_peak_load_kg"], squat * 1.25)), "sets": 3, "reps": 12},
            {"exercise": "bench press", "load_kg": round(squat * 0.55), "sets": 3, "reps": int(rng.integers(8, 11))},
        ]
        return {"exercises": ex}
    if device == "t2":
        speed = min(lim["t2_peak_speed_kmh"], prof["t2_speed_kmh"] * st.fitness)
        return {"speed_kmh": round(speed, 1), "harness_kg": round(prof["mass_kg"] * 0.7)}
    if device == "rehab":
        return {"focus": "walking, strength, balance"}
    watts = min(cfg["cevis_limits"]["max_watts"], prof["cevis_watts"] * st.fitness)
    return {"watts": round(watts)}


def exercise_hr(cfg: dict, prof: dict, device: str, details: dict, rng) -> tuple[float, float]:
    """Average and peak heart rate for a session, from intensity."""
    rest = prof["hr_rest"]
    m = cfg["model"]
    if device == "ared":
        avg = rest + 42
    elif device == "t2":
        avg = rest + 6.0 * details.get("speed_kmh", 9)
    elif device == "rehab":
        avg = rest + 30
    else:
        avg = rest + m["hr_per_watt"] * details.get("watts", 150)
    avg = min(avg, rest + m["hr_max_offset"]) + rng.normal(0, 3)
    return round(avg), round(min(avg + 18 + rng.normal(0, 3), rest + m["hr_max_offset"] + 10))


def _score(v: float, lo: float = 1, hi: float = 5) -> float:
    return float(np.clip(round(v), lo, hi))


def simulate_day(cfg: dict, seed: int, crew_idx: int, prof: dict, st: CrewState, day: int,
                 inp: DayInputs) -> dict[str, Any]:
    """Return the day's behaviour and physiology. Mutates `st` (slow variables)."""
    m = cfg["model"]
    rb = rng_for(seed, crew_idx, day, "behaviour")
    rp = rng_for(seed, crew_idx, day, "physiology")
    rm = rng_for(seed, crew_idx, day, "mind")
    rv = rng_for(seed, crew_idx, day, "vestibular")
    phase = phase_of(cfg, day)
    inflight = phase == "inflight"
    post = phase == "postflight"
    r_day = day - landing_day(cfg) if post else None
    ev = _event_params(inp.events)
    a = adaptation(day, m["calcium_rise_tau_days"], landing_day(cfg), m["calcium_recovery_tau_days"])
    if st.mass is None:
        st.mass = float(prof["mass_kg"])
    mass = st.mass

    # ---- exercise --------------------------------------------------------
    adherence = m["exercise_adherence"]
    if "missed_workouts" in ev:
        adherence = ev["missed_workouts"].get("adherence", 0.15)
    sessions: list[dict] = []
    user_by_device: dict[str, list[dict]] = {}
    for w in inp.user_workouts:
        user_by_device.setdefault(w["device"], []).append(w)
    user_slots = {slot_of(d) for d in user_by_device}
    plan = planned_sessions(cfg, day, eva="eva" in ev)
    for p in plan:
        dev = p["device"]
        if p["slot"] in user_slots:
            continue      # crew logged this session themselves
        if p["slot"] in inp.workout_tasks_done:
            done = True
        elif inp.autopilot:
            done = rb.random() < adherence
        else:
            done = False
        if done:
            minutes = p["minutes"] + float(rb.normal(0, 3))
            details = session_details(cfg, prof, st, dev, minutes, rb)
            avg, peak = exercise_hr(cfg, prof, dev, details, rb)
            sessions.append({"device": dev, "minutes": round(minutes, 1), "avg_hr": avg, "max_hr": peak,
                             "details": details, "source": "task" if p["slot"] in inp.workout_tasks_done else "sim"})
    for dev, ws in user_by_device.items():
        for w in ws:
            sessions.append({**w, "source": "user"})
    for s in sessions:     # live sessions already carry the energy counted during the workout
        s["kcal"] = round(s["details"].get("kcal") or session_kcal(cfg, s["device"], s["details"], s["minutes"], mass), 1)
        s["details"] = {**s["details"], "kcal": s["kcal"]}

    ared_min = sum(s["minutes"] for s in sessions if s["device"] == "ared")
    t2_min = sum(s["minutes"] for s in sessions if s["device"] == "t2")
    cevis_min = sum(s["minutes"] for s in sessions if s["device"] == "cevis")
    rehab_min = sum(s["minutes"] for s in sessions if s["device"] == "rehab")
    ex_min = ared_min + t2_min + cevis_min + rehab_min
    ex_h = ex_min / 60.0
    st.ared_7.append(ared_min)
    st.ex_7.append(ex_min)
    plan_ared = cfg["prescription"]["ared_min"]
    if not post:
        deficit_today = max(0.0, 1.0 - ared_min / plan_ared)
        st.bone_deficit = 0.9 * st.bone_deficit + 0.1 * deficit_today
    if ared_min > 0 or rehab_min > 0:
        st.strength = min(1.25, st.strength + 0.0015)
    else:
        st.strength = max(0.8, st.strength - 0.003)
    if t2_min + cevis_min + rehab_min > 0:
        st.fitness = min(1.2, st.fitness + 0.001)
    else:
        st.fitness = max(0.85, st.fitness - 0.002)

    # ---- intake -----------------------------------------------------------
    planned_min = sum(p["minutes"] for p in plan)
    target = water_target(cfg, planned_min)
    habit = prof.get("water_habit_inflight_l", prof["water_habit_l"]) if inflight else prof["water_habit_l"]
    water = habit * ev.get("dehydration", {}).get("water_factor", 1.0)
    water += 0.1 * ex_h + float(rb.normal(0, 0.18))
    if inp.water_task_done:
        water = max(water, target)
    water = max(0.6, water) + inp.water_extra_l

    kcal_mean = 2296 + (prof["mass_kg"] - 70) * cfg["energy"]["intake_kcal_per_kg"]
    kcal = float(np.clip(rb.normal(kcal_mean, 280), 1500, 3600))
    if "fever" in ev:
        kcal *= 0.8
    food = {"kcal": kcal, "protein_g": kcal * 0.16 / 4, "sodium_mg": float(rb.normal(3900, 450)),
            "calcium_mg": float(rb.normal(900, 120)), "vitd_iu": float(max(0, rb.normal(200, 50)))}
    for f in inp.food_entries:
        for k in ("kcal", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu"):
            food[k] += f.get(k, 0)
        water += f.get("water_l", 0)
    rl = rng_for(seed, crew_idx, day, "lsah")
    lm = cfg["lsah"]["model"]
    if rl.random() < prof.get("vitd_supplement_adherence", 0.9):     # daily vitamin D tablet habit
        food["vitd_iu"] += lm["vitd_tablet_iu"]

    # ---- supplements ------------------------------------------------------
    doses: dict[int, dict] = {}
    for p in inp.protocols:
        pid = p["id"]
        if pid in inp.doses_confirmed:
            taken, src = True, "crew"
        elif inp.autopilot:
            taken, src = bool(rb.random() < m["supplement_adherence"]), "sim"
        else:
            taken, src = False, "missed"
        alpha = m["protocol_onset_alpha"]
        st.adherence[pid] = (1 - alpha) * st.adherence.get(pid, 0.0) + alpha * (1.0 if taken else 0.0)
        doses[pid] = {"taken": taken, "source": src}
    eff = {"citrate_mg": 0.0, "ph": 0.0, "potassium_meq": 0.0}
    for p in inp.protocols:
        pdef = cfg["protocols"][p["type"]]
        adh = st.adherence.get(p["id"], 0.0)
        rf = prof["response_factor"]
        eff["citrate_mg"] += pdef["effects"]["citrate_mg"] * adh * rf
        eff["ph"] += pdef["effects"]["ph"] * adh * rf
        eff["potassium_meq"] += pdef["effects"]["potassium_meq"] * adh

    # ---- sleep (night after this day) ---------------------------------------
    sleep = prof["sleep_h"] + (m["sleep_inflight_delta_h"] if inflight else 0.0)
    sleep += ev.get("poor_sleep", {}).get("sleep_delta_h", 0.0)
    sleep += float(rp.normal(0, 0.4))
    sleep = float(np.clip(sleep, 3.0, 9.5))
    sleep_q = float(np.clip(rp.normal(88, 3) - (10 if "poor_sleep" in ev else 0) - (5 if "fever" in ev else 0), 55, 98))
    light = float(max(20, rp.normal(150 if inflight else 420, 30 if inflight else 80)))
    prev_sleep = st.last_sleep_h if st.last_sleep_h is not None else prof["sleep_h"]
    st.last_sleep_h = sleep

    # ---- vitals ----------------------------------------------------------
    fever = ev.get("fever", {}).get("core_temp_delta", 0.0)
    dehydrated = water < 0.8 * habit
    post_rise = m["hr_postflight_rise"] * math.exp(-r_day / 5.0) if post else 0.0
    hr = (prof["hr_rest"] + (1.0 if inflight else 0.0) + post_rise + max(0.0, 6.5 - prev_sleep) * 2.2
          + (4.0 if dehydrated else 0.0) + fever * 8 - (st.fitness - 1.0) * 30 + float(rp.normal(0, 1.4)))
    activity = 180.0 if inflight else 260.0 - (80.0 * math.exp(-r_day / 4.0) if post else 0.0)
    vitals = {
        "hr_rest": hr,
        "resp_rate": 14 + float(rp.normal(0, 0.7)) + fever * 2.5,
        "bp_sys": 114 + (prof["mass_kg"] - 70) * 0.15 - (3 if inflight else 0) + float(rp.normal(0, 3.5)),
        "bp_dia": 74 + float(rp.normal(0, 2.5)),
        "skin_temp": 33.6 + float(rp.normal(0, 0.2)) + fever * 0.6,
        "spo2": float(np.clip(98.2 + rp.normal(0, 0.5) - max(0, ev.get("co2_spike", {}).get("co2_delta_mmhg", 0)) * 0.3, 90, 100)),
        "activity": float(max(20, rp.normal(activity, 22))),
        "core_temp": 36.75 + (0.2 if inflight else 0.0) + (0.08 if ex_min > 60 else 0.0) + fever + float(rp.normal(0, 0.07)),
    }

    # ---- environment -------------------------------------------------------
    co2 = m["co2_mmhg"]["inflight" if inflight else "preflight"] + float(rp.normal(0, 0.25))
    co2 += ev.get("co2_spike", {}).get("co2_delta_mmhg", 0.0)
    rate = m["radiation_msv_per_day"].get(inp.profile, 0.5) if inflight else m["radiation_msv_per_day"]["preflight"]
    rad = rate * (1 + float(rp.normal(0, 0.08))) + ev.get("solar_particle_event", {}).get("dose_msv", 0.0)
    if inflight:
        st.rad_cum += rad
    env = {"co2_mmhg": max(0.1, co2), "rad_msv": max(0.0, rad), "rad_cum": st.rad_cum}

    # ---- urine (24 h) ------------------------------------------------------
    uv = m["urine_volume"]
    vol = (uv["water_coef"] * water + uv["food_water_l"] - uv["sweat_l_per_ex_hour"] * ex_h
           + (uv["inflight_shift_l"] if inflight else 0.0) - 0.25 * fever + float(rp.normal(0, uv["noise_sd"])))
    vol = float(np.clip(vol, 0.6, 4.5))
    u = prof["urine"]
    ca_rise = a * (m["calcium_inflight_max_rise"] * 0.85 + m["calcium_low_resistance_extra"] * st.bone_deficit)
    calcium = u["calcium"] * (1 + ca_rise) * (1 + float(rp.normal(0, 0.04)))
    calcium += (food["sodium_mg"] - 3900) * 0.004
    citrate = u["citrate"] * (1 - m["citrate_inflight_drop"] * a) + eff["citrate_mg"] + float(rp.normal(0, 22))
    ph = u["ph"] - m["ph_inflight_drop"] * a + eff["ph"] + float(rp.normal(0, 0.06))
    oxalate = u["oxalate"] * (1 + float(rp.normal(0, 0.07)))
    urine = {
        "u_volume": vol,
        "u_calcium": max(20.0, calcium),
        "u_citrate": max(50.0, citrate),
        "u_oxalate": max(5.0, oxalate),
        "u_uric_acid": u["uric_acid"] * (1 + float(rp.normal(0, 0.06))),
        "u_ph": float(np.clip(ph, 4.8, 7.6)),
        "u_sg": 1.0 + 0.032 / vol + float(rp.normal(0, 0.0008)),
        "u_creatinine": u["creatinine"] * (1 + float(rp.normal(0, 0.035))),
        "u_sodium": u["sodium"] + (food["sodium_mg"] - 3900) / 23.0 * 0.9 + float(rp.normal(0, 10)),
        "u_potassium": u["potassium"] + eff["potassium_meq"] + float(rp.normal(0, 4)),
        "u_magnesium": u["magnesium"] * (1 + float(rp.normal(0, 0.06))),
    }

    # ---- schedule, energy and body mass ------------------------------------
    blocks = day_schedule(cfg, day, ev, inp.link_delay_s, crew_idx)
    activities = day_activities(cfg, blocks, sessions, mass)
    kcal_out = sum(x["kcal"] for x in activities)
    kcal_ex = sum(x["kcal"] for x in activities if x["kind"] == "exercise")
    balance = food["kcal"] - kcal_out
    st.mass = mass + balance / cfg["energy"]["kcal_per_kg_body_mass"]
    energy = {"kcal_out": kcal_out, "kcal_exercise": kcal_ex, "energy_balance": balance,
              "mass_kg": st.mass + float(rp.normal(0, 0.12))}
    work_h = work_hours(cfg, blocks)
    contact_min = sum(x["minutes"] for x in activities if x["kind"] == "family_call")
    st.contact_7.append(contact_min)

    # ---- behavioural health -------------------------------------------------
    mi = cfg["mind"]
    sleep_debt = max(0.0, mi["sleep_need_h"] - prev_sleep)
    ex_frac = min(1.0, ex_min / planned_min) if planned_min else 1.0
    iso = ev.get("isolation", {}).get("connection_delta", 0.0)
    contact_week = sum(st.contact_7) if not post else mi["contact_ref_min_week"]
    stress = (mi["stress_base"] + mi["stress_per_work_h"] * max(0.0, work_h - mi["workload_ref_h"])
              + mi["stress_per_sleep_debt_h"] * sleep_debt + 0.25 * max(0.0, co2 - 3.0)
              - mi["stress_exercise_relief"] * ex_frac + 0.4 + (0.5 if iso else 0.0) + 0.5 * fever
              + float(rm.normal(0, 0.35)))
    tiredness = (mi["tiredness_base"] + mi["tiredness_per_sleep_debt_h"] * sleep_debt
                 + 0.3 * max(0.0, work_h - mi["workload_ref_h"]) + fever + (0.3 if dehydrated else 0.0)
                 + (0.8 * math.exp(-r_day / 3.0) if post else 0.0) + float(rm.normal(0, 0.35)))
    connection = (mi["connection_base"]
                  - mi["connection_no_contact_drop"] * (1.0 - min(1.0, contact_week / mi["contact_ref_min_week"]))
                  + iso + float(rm.normal(0, 0.3)))
    if inp.checkin:
        stress, tiredness, connection = inp.checkin["stress"], inp.checkin["tiredness"], inp.checkin["connection"]
    stress, tiredness, connection = _score(stress), _score(tiredness), _score(connection)

    feeling = inp.checkin["feeling"] if inp.checkin else inp.feeling
    if feeling is None:
        f = (4.0 + float(rp.normal(0, 0.5)) - (1.0 if "poor_sleep" in ev else 0) - (1.5 if fever else 0)
             - (0.7 if dehydrated else 0) - 0.35 * max(0.0, stress - 2) + (iso * 0.7 if iso else 0.0))
        feeling = f
    feeling = _score(feeling)
    wellbeing = ((feeling - 1) / 4 + (5 - stress) / 4 + (5 - tiredness) / 4 + (connection - 1) / 4) / 4 * 100

    rt = (prof["pvt_base_ms"] + mi["pvt_ms_per_sleep_debt_h"] * sleep_debt
          + mi["pvt_ms_per_co2_mmhg"] * max(0.0, co2 - 2.5) + mi["pvt_ms_per_tiredness"] * max(0.0, tiredness - 2)
          + 25 * fever + float(rm.normal(0, 9)))
    lapses = float(rm.poisson(max(0.05, mi["lapse_rate_base"] + mi["lapse_per_sleep_debt_h"] * sleep_debt
                                  + 0.5 * max(0.0, co2 - 3.0))))
    if inp.pvt:
        rt, lapses = float(inp.pvt["mean_rt_ms"]), float(inp.pvt["lapses"])
    mind = {"feeling": feeling, "stress": stress, "tiredness": tiredness, "connection": connection,
            "wellbeing": wellbeing, "pvt_rt_ms": rt, "pvt_lapses": lapses, "workload_h": work_h,
            "contact_week_min": contact_week}

    # ---- vestibular / return to Earth --------------------------------------
    vc = cfg["vestibular"]
    pv = prof["vestibular"]
    vest: dict[str, float] = {}
    if phase == "preflight":
        vest = {"vest_sot": pv["sot_base"] + float(rv.normal(0, 1.8)),
                "vest_tandem": float(np.clip(round(pv["tandem_base"] + rv.normal(0, 0.5)), 0, 10)),
                "vest_dizzy": float(np.clip(round(abs(rv.normal(0, 0.3))), 0, 10)),
                "ortho_hr_rise": vc["ortho_base_bpm"] + float(rv.normal(0, 2.5))}
    elif inflight:
        sas = vc["sas_peak"] * pv["susceptibility"] * math.exp(-day / 1.2) if day < vc["sas_days"] else 0.0
        vest = {"vest_dizzy": float(np.clip(round(sas + abs(rv.normal(0, 0.3))), 0, 10))}
        if inp.prelanding_done:
            st.prelanding_days += 1
    else:
        if st.landing is None:
            st.landing = landing_effects(cfg, prof, st.prelanding_days, st.fitness)
        L = st.landing
        if inp.vest_rehab_done:
            st.vest_rehab_days += 1
        rehab_frac = min(1.0, st.vest_rehab_days / max(1, r_day))
        tau = pv["tau_days"] * (1 - 0.2 * rehab_frac)
        k = math.exp(-r_day / tau)
        vest = {"vest_sot": pv["sot_base"] * (1 - L["sot_drop"] * k) + float(rv.normal(0, 1.8)),
                "vest_tandem": float(np.clip(round(pv["tandem_base"] - L["tandem_drop"] * k + rv.normal(0, 0.5)), 0, 10)),
                "vest_dizzy": float(np.clip(round(L["dizzy0"] * math.exp(-r_day / (tau * 0.8)) + abs(rv.normal(0, 0.3))), 0, 10)),
                "ortho_hr_rise": vc["ortho_base_bpm"] + L["ortho_rise"] * math.exp(-r_day / vc["ortho_tau_days"])
                + float(rv.normal(0, 2.5))}
    if inp.dizziness is not None:
        vest["vest_dizzy"] = float(inp.dizziness)

    # ---- LSAH clinical tests (only on their test days) ----------------------
    base = prof["lsah"]
    if st.vitd is None:
        st.vitd = float(base["vitd_serum"])
    vitd_target = (lm["vitd_inflight_floor_ng_ml"] + lm["vitd_ng_ml_per_100_iu"] * food["vitd_iu"] / 100.0
                   if inflight else float(base["vitd_serum"]))          # on the ground the sun keeps it up
    st.vitd += (vitd_target - st.vitd) / lm["vitd_tau_days"]
    if inflight:
        st.bmd_frac -= (lm["bmd_loss_pct_per_month"] + lm["bmd_loss_extra_pct_per_month"] * st.bone_deficit) / 100 / 30.44
    hb_factor = (1 - lm["hb_inflight_drop"] * (1 - math.exp(-(day + 1) / 10.0)) if inflight
                 else 1 - lm["hb_inflight_drop"] * math.exp(-r_day / 20.0) if post else 1.0)
    fit_eff = min(st.fitness, 1.02)       # exercise protects aerobic capacity; it does not keep raising it
    vo2_factor = fit_eff * (1 - lm["vo2_inflight_drop"] * math.exp(-day / 40.0) if inflight
                               else 1 - lm["vo2_postflight_drop"] * math.exp(-r_day / 7.0) if post else 1.0)
    lsah: dict[str, float] = {}
    for t in tests_on(cfg, day):
        if t["id"] not in inp.lsah_done:
            continue
        for m_id in t["metrics"]:
            if m_id == "bmd_hip":
                lsah[m_id] = base["bmd_hip"] * st.bmd_frac + float(rl.normal(0, 0.004))
            elif m_id == "vo2peak":
                lsah[m_id] = base["vo2peak"] * vo2_factor + float(rl.normal(0, 0.8))
            elif m_id == "vitd_serum":
                lsah[m_id] = max(5.0, st.vitd + float(rl.normal(0, 1.5)))
            elif m_id == "hemoglobin":
                lsah[m_id] = base["hemoglobin"] * hb_factor + float(rl.normal(0, 0.2))

    return {
        "day": day, "phase": phase, "sessions": sessions, "ex_min": ex_min, "ared_min": ared_min, "t2_min": t2_min,
        "cevis_min": cevis_min, "rehab_min": rehab_min, "water_l": water, "water_target_l": target, "food": food,
        "doses": doses, "sleep": {"sleep_h": sleep, "sleep_quality": sleep_q, "light_lux": light},
        "vitals": vitals, "env": env, "urine": urine, "feeling": feeling, "mind": mind, "vest": vest,
        "energy": energy, "activities": activities, "lsah": lsah,
        "ared_week_min": sum(st.ared_7), "ex_week_min": sum(st.ex_7),
    }
