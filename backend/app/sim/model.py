"""Coupled physiology 'truth' model for one crew member and one day.

Sources affect each other:
  * exercise -> exercise heart rate, sweat losses (lower urine volume), core temperature,
    and a higher water target;
  * water intake -> urine volume -> specific gravity and stone-risk supersaturation;
  * resistance exercise (ARED) -> how much urine calcium rises (bone loss);
  * protocols -> later urine samples, scaled by adherence (an EWMA of doses taken) and
    a per-person response factor;
  * sleep -> next resting heart rate and how the crew member feels.

Randomness is drawn from per-(seed, crew, day, stream) generators, so the same seed
and the same user actions always give the same data, independent of request order.
All coefficients live in config `model` (marked unverified).
"""
from __future__ import annotations

import hashlib
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np


def rng_for(seed: int, crew_idx: int, day: int, stream: str) -> np.random.Generator:
    h = int(hashlib.blake2s(stream.encode(), digest_size=4).hexdigest(), 16)
    return np.random.default_rng([seed, crew_idx, day + 10_000, h])


def adaptation(day: int, tau: float) -> float:
    """0 on the ground, rising toward 1 in flight."""
    return 0.0 if day < 0 else 1.0 - math.exp(-(day + 1) / tau)


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
    bone_deficit: float = 0.0           # EWMA of (1 - ARED minutes / plan)
    strength: float = 1.0               # multiplies ARED loads
    fitness: float = 1.0                # multiplies T2 speed / CEVIS watts
    adherence: dict = field(default_factory=dict)   # protocol_id -> EWMA of doses
    rad_cum: float = 0.0
    last_sleep_h: float | None = None


@dataclass
class DayInputs:
    """Everything outside the body that shapes one day."""
    autopilot: bool = True
    user_workouts: list[dict] = field(default_factory=list)   # logged by the crew member
    workout_tasks_done: set = field(default_factory=set)       # {'ared', 'cardio'} quick confirms
    water_task_done: bool = False
    water_extra_l: float = 0.0
    food_entries: list[dict] = field(default_factory=list)
    feeling: float | None = None
    protocols: list[dict] = field(default_factory=list)        # active: {id, type, start_day}
    doses_confirmed: set = field(default_factory=set)          # protocol ids confirmed today
    events: list[dict] = field(default_factory=list)           # active events with params
    profile: str = "iss"


def water_target(cfg: dict, planned_ex_min: float) -> float:
    m = cfg["model"]
    return round(m["water_target_base_l"] + m["water_target_per_ex_hour_l"] * planned_ex_min / 60.0, 2)


def planned_sessions(cfg: dict, day: int) -> list[dict]:
    p = cfg["prescription"]
    cardio = "t2" if day % 2 == 0 else "cevis"
    return [{"slot": "ared", "device": "ared", "minutes": p["ared_min"]},
            {"slot": "cardio", "device": cardio, "minutes": p["cardio_min"]}]


def _event_params(events: list[dict]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for e in events:
        out[e["kind"]] = e.get("params", {})
    return out


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
    else:
        avg = rest + m["hr_per_watt"] * details.get("watts", 150)
    avg = min(avg, rest + m["hr_max_offset"]) + rng.normal(0, 3)
    return round(avg), round(min(avg + 18 + rng.normal(0, 3), rest + m["hr_max_offset"] + 10))


def simulate_day(cfg: dict, seed: int, crew_idx: int, prof: dict, st: CrewState, day: int,
                 inp: DayInputs) -> dict[str, Any]:
    """Return the day's behaviour and physiology. Mutates `st` (slow variables)."""
    m = cfg["model"]
    rb = rng_for(seed, crew_idx, day, "behaviour")
    rp = rng_for(seed, crew_idx, day, "physiology")
    inflight = day >= 0
    ev = _event_params(inp.events)
    a = adaptation(day, m["calcium_rise_tau_days"])

    # ---- exercise --------------------------------------------------------
    adherence = m["exercise_adherence"]
    if "missed_workouts" in ev:
        adherence = ev["missed_workouts"].get("adherence", 0.15)
    sessions: list[dict] = []
    user_by_device: dict[str, list[dict]] = {}
    for w in inp.user_workouts:
        user_by_device.setdefault(w["device"], []).append(w)
    user_slots = {"ared" if d == "ared" else "cardio" for d in user_by_device}
    for plan in planned_sessions(cfg, day):
        dev = plan["device"]
        if plan["slot"] in user_slots:
            continue      # crew logged this session themselves
        if plan["slot"] in inp.workout_tasks_done:
            done = True
        elif inp.autopilot:
            done = rb.random() < adherence
        else:
            done = False
        if done:
            minutes = plan["minutes"] + float(rb.normal(0, 3))
            details = session_details(cfg, prof, st, dev, minutes, rb)
            avg, peak = exercise_hr(cfg, prof, dev, details, rb)
            sessions.append({"device": dev, "minutes": round(minutes, 1), "avg_hr": avg, "max_hr": peak,
                             "details": details, "source": "task" if plan["slot"] in inp.workout_tasks_done else "sim"})
    for dev, ws in user_by_device.items():
        for w in ws:
            sessions.append({**w, "source": "user"})

    ared_min = sum(s["minutes"] for s in sessions if s["device"] == "ared")
    t2_min = sum(s["minutes"] for s in sessions if s["device"] == "t2")
    cevis_min = sum(s["minutes"] for s in sessions if s["device"] == "cevis")
    ex_min = ared_min + t2_min + cevis_min
    ex_h = ex_min / 60.0
    st.ared_7.append(ared_min)
    st.ex_7.append(ex_min)
    plan_ared = cfg["prescription"]["ared_min"]
    deficit_today = max(0.0, 1.0 - ared_min / plan_ared)
    st.bone_deficit = 0.9 * st.bone_deficit + 0.1 * deficit_today
    if ared_min > 0:
        st.strength = min(1.25, st.strength + 0.0015)
    else:
        st.strength = max(0.8, st.strength - 0.003)
    if t2_min + cevis_min > 0:
        st.fitness = min(1.2, st.fitness + 0.001)
    else:
        st.fitness = max(0.85, st.fitness - 0.002)

    # ---- intake -----------------------------------------------------------
    planned_min = sum(p["minutes"] for p in planned_sessions(cfg, day))
    target = water_target(cfg, planned_min)
    habit = prof.get("water_habit_inflight_l", prof["water_habit_l"]) if inflight else prof["water_habit_l"]
    water = habit * ev.get("dehydration", {}).get("water_factor", 1.0)
    water += 0.1 * ex_h + float(rb.normal(0, 0.18))
    if inp.water_task_done:
        water = max(water, target)
    water = max(0.6, water) + inp.water_extra_l

    kcal = float(np.clip(rb.normal(2296 + (prof["mass_kg"] - 70) * 12, 280), 1500, 3300))
    if "fever" in ev:
        kcal *= 0.8
    food = {"kcal": kcal, "protein_g": kcal * 0.16 / 4, "sodium_mg": float(rb.normal(3900, 450)),
            "calcium_mg": float(rb.normal(900, 120)), "vitd_iu": float(max(0, rb.normal(200, 50)))}
    for f in inp.food_entries:
        for k in ("kcal", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu"):
            food[k] += f.get(k, 0)
        water += f.get("water_l", 0)

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
    hr = (prof["hr_rest"] + (1.0 if inflight else 0.0) + max(0.0, 6.5 - prev_sleep) * 2.2
          + (4.0 if dehydrated else 0.0) + fever * 8 - (st.fitness - 1.0) * 30 + float(rp.normal(0, 1.4)))
    vitals = {
        "hr_rest": hr,
        "resp_rate": 14 + float(rp.normal(0, 0.7)) + fever * 2.5,
        "bp_sys": 114 + (prof["mass_kg"] - 70) * 0.15 - (3 if inflight else 0) + float(rp.normal(0, 3.5)),
        "bp_dia": 74 + float(rp.normal(0, 2.5)),
        "skin_temp": 33.6 + float(rp.normal(0, 0.2)) + fever * 0.6,
        "spo2": float(np.clip(98.2 + rp.normal(0, 0.5) - max(0, ev.get("co2_spike", {}).get("co2_delta_mmhg", 0)) * 0.3, 90, 100)),
        "activity": float(max(20, rp.normal(180 if inflight else 260, 22))),
        "core_temp": 36.75 + (0.2 if inflight else 0.0) + (0.08 if ex_min > 60 else 0.0) + fever + float(rp.normal(0, 0.07)),
    }

    # ---- environment -------------------------------------------------------
    co2 = m["co2_mmhg"]["inflight" if inflight else "preflight"] + float(rp.normal(0, 0.25))
    co2 += ev.get("co2_spike", {}).get("co2_delta_mmhg", 0.0)
    rate = m["radiation_msv_per_day"]["preflight"] if not inflight else m["radiation_msv_per_day"].get(inp.profile, 0.5)
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

    feeling = inp.feeling
    if feeling is None:
        f = 4.0 + float(rp.normal(0, 0.5)) - (1.0 if "poor_sleep" in ev else 0) - (1.5 if fever else 0) - (0.7 if dehydrated else 0)
        feeling = float(np.clip(round(f), 1, 5))

    return {
        "day": day, "sessions": sessions, "ex_min": ex_min, "ared_min": ared_min, "t2_min": t2_min,
        "cevis_min": cevis_min, "water_l": water, "water_target_l": target, "food": food, "doses": doses,
        "sleep": {"sleep_h": sleep, "sleep_quality": sleep_q, "light_lux": light},
        "vitals": vitals, "env": env, "urine": urine, "feeling": feeling,
        "ared_week_min": sum(st.ared_7), "ex_week_min": sum(st.ex_7),
    }
