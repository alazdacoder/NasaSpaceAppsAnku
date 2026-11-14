"""Simulated device adapters. Each one reads the coupled physiology model and reports
only the metrics its real counterpart would measure, at that device's precision."""
from __future__ import annotations

import hashlib
import math
from typing import Any

from .base import DeviceAdapter, DeviceStatus


def _h(*parts: Any) -> float:
    """Deterministic pseudo-random number in [0, 1) from the given parts."""
    s = "|".join(str(p) for p in parts).encode()
    return int(hashlib.blake2s(s, digest_size=6).hexdigest(), 16) / float(1 << 48)


class SimAdapter(DeviceAdapter):
    battery_hours: float = 24.0        # real-time minutes per full drain in the demo (scaled)
    group: str = ""

    def read_day(self, crew_id: str, day: int, world: Any) -> dict[str, float]:
        if not self.enabled:
            return {}
        truth = world.day_truth(crew_id, day)
        if truth is None:
            return {}
        vals = self.extract(truth)
        self.last_sync[crew_id] = day + 1.0
        return {k: v for k, v in vals.items() if v is not None}

    def extract(self, truth: dict) -> dict[str, float]:
        return {k: truth[self.group][k] for k in self.metrics if k in truth.get(self.group, {})}

    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        if not self.enabled:
            return DeviceStatus(self.id, False, None, self.last_sync.get(crew_id), "disabled",
                                "Disabled from the Devices screen")
        battery = None
        if self.has_battery:
            period = self.battery_hours * 60.0       # demo: one full cycle per battery_hours real minutes
            phase = (real_t / period + _h(self.id, crew_id)) % 1.0
            battery = round(100 - 85 * phase)
        last = max(self.last_sync.get(crew_id, 0.0), mission_t - (_h(self.id, crew_id, int(real_t // 7)) * 0.02))
        state = "syncing" if _h(self.id, crew_id, int(real_t // 3)) < 0.06 else "connected"
        note = "Charging" if battery is not None and battery > 97 else ""
        return DeviceStatus(self.id, True, battery, last, state, note)


class AREDAdapter(SimAdapter):
    id, name, kind = "ared", "ARED (Advanced Resistive Exercise Device)", "exercise"
    description = "Resistance exercise: exercise, load, sets and reps. Peak load 272 kg."
    metrics = ("ared_squat_kg",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        loads = [e["load_kg"] for s in truth["sessions"] if s["device"] == "ared"
                 for e in s["details"].get("exercises", []) if e["exercise"] == "squat"]
        return {"ared_squat_kg": max(loads)} if loads else {}


class T2Adapter(SimAdapter):
    id, name, kind = "t2", "T2 treadmill", "exercise"
    description = "Running: speed, time and harness load. Peak speed 19.3 km/h."
    metrics = ("t2_speed_kmh",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        sp = [s["details"]["speed_kmh"] for s in truth["sessions"] if s["device"] == "t2" and "speed_kmh" in s["details"]]
        return {"t2_speed_kmh": sum(sp) / len(sp)} if sp else {}


class CEVISAdapter(SimAdapter):
    id, name, kind = "cevis", "CEVIS cycle ergometer", "exercise"
    description = "Cycling: power (watts) and time."
    metrics = ("cevis_watts",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        w = [s["details"]["watts"] for s in truth["sessions"] if s["device"] == "cevis" and "watts" in s["details"]]
        return {"cevis_watts": sum(w) / len(w)} if w else {}


class BioMonitorAdapter(SimAdapter):
    id, name, kind = "biomonitor", "Bio-Monitor smart shirt + headband", "wearable"
    description = "Heart rate / ECG, breathing rate, blood pressure, skin temperature, blood oxygen, activity."
    metrics = ("hr_rest", "resp_rate", "bp_sys", "bp_dia", "skin_temp", "spo2", "activity", "hr_exercise")
    group = "vitals"
    battery_hours = 18

    def extract(self, truth: dict) -> dict[str, float]:
        v = {k: truth["vitals"][k] for k in self.metrics if k in truth["vitals"]}
        hrs = [(s["avg_hr"], s["minutes"]) for s in truth["sessions"] if s.get("avg_hr")]
        if hrs:
            v["hr_exercise"] = sum(h * mnt for h, mnt in hrs) / max(1e-6, sum(mnt for _, mnt in hrs))
        return v

    def live(self, crew_id: str, mission_t: float, world: Any) -> dict[str, float]:
        if not self.enabled:
            return {}
        base = world.last_truth(crew_id)
        if base is None:
            return {}
        v = base["vitals"]
        frac = mission_t % 1.0
        minute = int(mission_t * 1440)
        circ = math.sin(2 * math.pi * (frac - 0.35))          # higher in the afternoon
        asleep = frac < 0.25 or frac > 0.94
        hr = v["hr_rest"] + (0 if asleep else 9) + 4 * circ + (_h(crew_id, minute, "hr") - 0.5) * 4
        live_w = world.live_workout(crew_id)
        if live_w:
            hr = live_w["hr"]
        return {
            "hr": round(hr), "resp_rate": round(v["resp_rate"] + (0 if asleep else 1) + (_h(crew_id, minute, "rr") - 0.5) * 2, 1),
            "bp_sys": round(v["bp_sys"] + 3 * circ), "bp_dia": round(v["bp_dia"] + 2 * circ),
            "skin_temp": round(v["skin_temp"] + 0.2 * circ, 1),
            "spo2": round(min(100, v["spo2"] + (_h(crew_id, minute, "o2") - 0.5)), 0),
            "activity": round(0 if asleep else v["activity"] * (0.6 + _h(crew_id, minute, "act"))),
            "asleep": asleep,
        }


class ActiwatchAdapter(SimAdapter):
    id, name, kind = "actiwatch", "Wrist actigraph (Actiwatch type)", "wearable"
    description = "Sleep duration and quality, light exposure."
    metrics = ("sleep_h", "sleep_quality", "light_lux")
    group = "sleep"
    battery_hours = 40


class TMiniAdapter(SimAdapter):
    id, name, kind = "tmini", "Core temperature headband (T-Mini type)", "wearable"
    description = "Core body temperature from a heat-flux sensor."
    metrics = ("core_temp",)
    group = "vitals"
    battery_hours = 20

    def live(self, crew_id: str, mission_t: float, world: Any) -> dict[str, float]:
        base = world.last_truth(crew_id)
        if base is None or not self.enabled:
            return {}
        frac = mission_t % 1.0
        circ = math.sin(2 * math.pi * (frac - 0.35))
        bump = 0.4 if world.live_workout(crew_id) else 0.0
        return {"core_temp": round(base["vitals"]["core_temp"] + 0.25 * circ + bump, 2)}


class CO2Adapter(SimAdapter):
    id, name, kind = "co2", "Personal CO2 monitor", "environment"
    description = "CO2 partial pressure in the air you breathe."
    metrics = ("co2_mmhg",)
    group = "env"
    battery_hours = 30

    def live(self, crew_id: str, mission_t: float, world: Any) -> dict[str, float]:
        base = world.last_truth(crew_id)
        if base is None or not self.enabled:
            return {}
        minute = int(mission_t * 1440)
        return {"co2_mmhg": round(max(0.1, base["env"]["co2_mmhg"] + (_h(crew_id, minute, "co2") - 0.5) * 0.6), 2)}


class DosimeterAdapter(SimAdapter):
    id, name, kind = "dosimeter", "Personal radiation dosimeter", "environment"
    description = "Daily and cumulative radiation dose."
    metrics = ("rad_msv", "rad_cum")
    group = "env"
    battery_hours = 60


class UWMSAdapter(SimAdapter):
    id, name, kind = "uwms", "Urine sensor bay (UWMS, before the UPA)", "lab"
    description = ("24 h urine chemistry sampled in the toilet before the Urine Processor Assembly: "
                   "calcium, citrate, oxalate, uric acid, pH, specific gravity, volume, creatinine, "
                   "sodium, potassium, magnesium.")
    metrics = ("u_volume", "u_calcium", "u_citrate", "u_oxalate", "u_uric_acid", "u_ph", "u_sg",
               "u_creatinine", "u_sodium", "u_potassium", "u_magnesium")
    group = "urine"
    has_battery = False


def all_sim_adapters() -> list[DeviceAdapter]:
    return [AREDAdapter(), T2Adapter(), CEVISAdapter(), BioMonitorAdapter(), ActiwatchAdapter(),
            TMiniAdapter(), CO2Adapter(), DosimeterAdapter(), UWMSAdapter()]
