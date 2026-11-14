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
                                "Disabled from the Devices screen", "Cihazlar ekranından devre dışı bırakıldı")
        battery = None
        if self.has_battery:
            period = self.battery_hours * 60.0       # demo: one full cycle per battery_hours real minutes
            phase = (real_t / period + _h(self.id, crew_id)) % 1.0
            battery = round(100 - 85 * phase)
        last = max(self.last_sync.get(crew_id, 0.0), mission_t - (_h(self.id, crew_id, int(real_t // 7)) * 0.02))
        state = "syncing" if _h(self.id, crew_id, int(real_t // 3)) < 0.06 else "connected"
        charging = battery is not None and battery > 97
        return DeviceStatus(self.id, True, battery, last, state, "Charging" if charging else "",
                            "Şarj oluyor" if charging else "")


class AREDAdapter(SimAdapter):
    id, name, kind = "ared", "ARED (Advanced Resistive Exercise Device)", "exercise"
    name_tr = "ARED (gelişmiş direnç egzersiz cihazı)"
    description = "Resistance exercise: exercise, load, sets and reps. Peak load 272 kg."
    description_tr = "Direnç egzersizi: hareket, yük, set ve tekrar. Tepe yük 272 kg."
    metrics = ("ared_squat_kg",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        loads = [e["load_kg"] for s in truth["sessions"] if s["device"] == "ared"
                 for e in s["details"].get("exercises", []) if e["exercise"] == "squat"]
        return {"ared_squat_kg": max(loads)} if loads else {}


class T2Adapter(SimAdapter):
    id, name, kind = "t2", "T2 treadmill", "exercise"
    name_tr = "T2 koşu bandı"
    description = "Running: speed, time and harness load. Peak speed 19.3 km/h."
    description_tr = "Koşu: hız, süre ve kemer yükü. Tepe hız 19.3 km/sa."
    metrics = ("t2_speed_kmh",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        sp = [s["details"]["speed_kmh"] for s in truth["sessions"] if s["device"] == "t2" and "speed_kmh" in s["details"]]
        return {"t2_speed_kmh": sum(sp) / len(sp)} if sp else {}


class CEVISAdapter(SimAdapter):
    id, name, kind = "cevis", "CEVIS cycle ergometer", "exercise"
    name_tr = "CEVIS bisiklet ergometresi"
    description = "Cycling: power (watts) and time."
    description_tr = "Pedal: güç (watt) ve süre."
    metrics = ("cevis_watts",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        w = [s["details"]["watts"] for s in truth["sessions"] if s["device"] == "cevis" and "watts" in s["details"]]
        return {"cevis_watts": sum(w) / len(w)} if w else {}


class BioMonitorAdapter(SimAdapter):
    id, name, kind = "biomonitor", "Bio-Monitor smart shirt + headband", "wearable"
    name_tr = "Bio-Monitor akıllı tişört + kafa bandı"
    description = "Heart rate / ECG, breathing rate, blood pressure, skin temperature, blood oxygen, activity, cephalad fluid shift."
    description_tr = "Nabız / EKG, solunum hızı, kan basıncı, deri sıcaklığı, kan oksijeni, hareketlilik, başa doğru sıvı kayması."
    metrics = ("hr_rest", "resp_rate", "bp_sys", "bp_dia", "skin_temp", "spo2", "activity", "hr_exercise", "fluid_shift_ml")
    group = "vitals"
    battery_hours = 18

    def extract(self, truth: dict) -> dict[str, float]:
        v = {k: truth["vitals"][k] for k in self.metrics if k in truth["vitals"]}
        if "fluid_shift_ml" in truth.get("ocular", {}):
            v["fluid_shift_ml"] = truth["ocular"]["fluid_shift_ml"]
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
    name_tr = "Bilek aktigrafı (Actiwatch tipi)"
    description = "Sleep duration and quality, light exposure."
    description_tr = "Uyku süresi ve kalitesi, ışık maruziyeti."
    metrics = ("sleep_h", "sleep_quality", "light_lux")
    group = "sleep"
    battery_hours = 40


class TMiniAdapter(SimAdapter):
    id, name, kind = "tmini", "Core temperature headband (T-Mini type)", "wearable"
    name_tr = "Vücut iç sıcaklığı bandı (T-Mini tipi)"
    description = "Core body temperature from a heat-flux sensor."
    description_tr = "Isı akışı sensörüyle vücut iç sıcaklığı."
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
    name_tr = "Kişisel CO2 monitörü"
    description = "CO2 partial pressure in the air you breathe."
    description_tr = "Soluduğun havadaki CO2 kısmi basıncı."
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
    name_tr = "Kişisel radyasyon dozimetresi"
    description = "Daily and cumulative radiation dose."
    description_tr = "Günlük ve toplam radyasyon dozu."
    metrics = ("rad_msv", "rad_cum")
    group = "env"
    battery_hours = 60


class UWMSAdapter(SimAdapter):
    id, name, kind = "uwms", "Urine sensor bay (UWMS, before the UPA)", "lab"
    name_tr = "İdrar sensör bölmesi (UWMS, UPA öncesi)"
    description = ("24 h urine chemistry sampled in the toilet before the Urine Processor Assembly: "
                   "calcium, citrate, oxalate, uric acid, pH, specific gravity, volume, creatinine, "
                   "sodium, potassium, magnesium.")
    description_tr = ("Tuvalette, İdrar İşleme Ünitesi'nden (UPA) önce alınan 24 saatlik idrar kimyası: "
                      "kalsiyum, sitrat, oksalat, ürik asit, pH, özgül ağırlık, hacim, kreatinin, "
                      "sodyum, potasyum, magnezyum.")
    metrics = ("u_volume", "u_calcium", "u_citrate", "u_oxalate", "u_uric_acid", "u_ph", "u_sg",
               "u_creatinine", "u_sodium", "u_potassium", "u_magnesium")
    group = "urine"
    has_battery = False


class SLAMMDAdapter(SimAdapter):
    id, name, kind = "slammd", "SLAMMD body-mass device", "lab"
    name_tr = "SLAMMD vücut kütlesi ölçer"
    description = ("Space Linear Acceleration Mass Measurement Device: body mass from the acceleration a known "
                   "force produces (scales do not work in weightlessness).")
    description_tr = ("Uzay Doğrusal İvme Kütle Ölçüm Cihazı: bilinen bir kuvvetin oluşturduğu ivmeden vücut "
                      "kütlesini ölçer (ağırlıksızlıkta tartı çalışmaz).")
    metrics = ("mass_kg",)
    has_battery = False

    def extract(self, truth: dict) -> dict[str, float]:
        return {"mass_kg": truth["energy"]["mass_kg"]}


class PVTAdapter(SimAdapter):
    id, name, kind = "pvt", "Reaction test (PVT, tablet app)", "app"
    name_tr = "Tepki testi (PVT, tablet uygulaması)"
    description = "3-minute psychomotor vigilance test: reaction time and attention lapses. The crew can also take it on the Mind screen."
    description_tr = "3 dakikalık psikomotor dikkat testi: tepki süresi ve dikkat kaymaları. Mürettebat Zihin ekranında da yapabilir."
    metrics = ("pvt_rt_ms", "pvt_lapses")
    group = "mind"
    has_battery = False


class PosturographyAdapter(SimAdapter):
    id, name, kind = "posturography", "Balance clinic (posturography, tandem walk, stand test)", "clinic"
    name_tr = "Denge kliniği (postürografi, tandem yürüyüş, ayağa kalkma testi)"
    description = ("Ground clinic tests before launch and after landing: computerized dynamic posturography "
                   "(SOT), tandem walk with eyes closed and a stand test for heart-rate rise.")
    description_tr = ("Fırlatmadan önce ve inişten sonra yer kliniği testleri: bilgisayarlı dinamik postürografi "
                      "(SOT), gözler kapalı tandem yürüyüş ve nabız artışı için ayağa kalkma testi.")
    metrics = ("vest_sot", "vest_tandem", "ortho_hr_rise")
    group = "vest"
    has_battery = False

    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        st = super().status(crew_id, mission_t, real_t)
        cfg_landing = getattr(self, "landing_day", 180)
        if st.connected and 0 <= mission_t < cfg_landing:
            return DeviceStatus(self.id, True, None, self.last_sync.get(crew_id), "standby",
                                "On the ground: used before launch and after landing",
                                "Yerde: fırlatmadan önce ve inişten sonra kullanılır")
        return st


class LSAHClinicMixin:
    """Ground clinic tests: in standby while the crew is in flight."""

    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        st = super().status(crew_id, mission_t, real_t)          # type: ignore[misc]
        if st.connected and 0 <= mission_t < getattr(self, "landing_day", 180):
            return DeviceStatus(self.id, True, None, self.last_sync.get(crew_id), "standby",   # type: ignore[attr-defined]
                                "On the ground: before launch and after landing",
                                "Yerde: fırlatmadan önce ve inişten sonra")
        return st


class DXAAdapter(LSAHClinicMixin, SimAdapter):
    id, name, kind = "dxa", "Bone densitometry (DXA) - LSAH", "clinic"
    name_tr = "Kemik yoğunluğu ölçümü (DXA) - LSAH"
    description = "Dual-energy X-ray absorptiometry of the hip before launch and after landing (LSAH category: Bone Densitometry)."
    description_tr = "Fırlatmadan önce ve inişten sonra kalçanın çift enerjili X-ışını absorpsiyometrisi (LSAH kategorisi: Kemik yoğunluğu ölçümü)."
    metrics = ("bmd_hip",)
    group = "lsah"
    has_battery = False


class GXTAdapter(SimAdapter):
    id, name, kind = "gxt", "Graded exercise test on CEVIS - LSAH", "exercise"
    name_tr = "CEVIS'te kademeli egzersiz testi - LSAH"
    description = "VO2peak from a graded cycle test before, during and after flight (LSAH category: Aerobic Functional Capacity)."
    description_tr = "Uçuş öncesi, sırası ve sonrası kademeli bisiklet testinden VO2peak (LSAH kategorisi: Aerobik fonksiyonel kapasite)."
    metrics = ("vo2peak",)
    group = "lsah"
    has_battery = False


class BloodLabAdapter(SimAdapter):
    id, name, kind = "blood_lab", "Blood draw kit + centrifuge - LSAH", "lab"
    name_tr = "Kan alma kiti + santrifüj - LSAH"
    description = "Scheduled blood draws: serum vitamin D and hemoglobin (LSAH category: Laboratory Testing)."
    description_tr = "Planlı kan alımları: serum D vitamini ve hemoglobin (LSAH kategorisi: Laboratuvar testleri)."
    metrics = ("vitd_serum", "hemoglobin")
    group = "lsah"
    has_battery = False


class SpaceTonometerAdapter(SimAdapter):
    id, name, kind = "tonometer", "Space Ocular Tonometer & OCT Pod", "wearable"
    name_tr = "Uzay Göz Tonometresi ve OCT Ünitesi"
    description = ("Paired wireless rebound tonometer and optic nerve ultrasound pod: live intraocular pressure (IOP), "
                   "optic nerve sheath diameter (ONSD) and non-invasive intracranial pressure (ICP).")
    description_tr = ("Eşleştirilmiş kablosuz geri tepmeli tonometre ve optik sinir ultrason ünitesi: canlı göz içi basıncı (GİB), "
                      "optik sinir kılıfı çapı (ONSD) ve invaziv olmayan kafa içi basınç (KİB).")
    metrics = ("iop_mmhg", "onsd_mm", "icp_mmhg")
    group = "ocular"
    battery_hours = 36

    def live(self, crew_id: str, mission_t: float, world: Any) -> dict[str, Any]:
        base = world.last_truth(crew_id)
        if base is None or not self.enabled:
            return {}
        oc = base.get("ocular", {})
        frac = mission_t % 1.0
        minute = int(mission_t * 1440)
        # Supine/microgravity nocturnal & morning circadian IOP wave
        circ = math.cos(2 * math.pi * (frac - 0.22))
        ev_today = world._event_kinds(crew_id, world.today) if hasattr(world, "_event_kinds") else {}
        spike = ev_today.get("ocular_spike", {})
        iop_bump = float(spike.get("iop_delta_mmhg", 0.0))
        shift_bump = float(spike.get("fluid_shift_delta_ml", 0.0))
        iop_base = float(oc.get("iop_mmhg", 18.2))
        # If ocular_spike started today and wasn't in yesterday's closed truth yet, apply it live
        if iop_bump > 0 and iop_base < 23.0:
            iop_base += iop_bump
        iop = round(iop_base + 0.8 * circ + (_h(crew_id, minute, "iop") - 0.5) * 0.5, 1)
        od = round(iop + (_h(crew_id, minute, "od") - 0.45) * 0.4, 1)
        os_val = round(iop - (_h(crew_id, minute, "os") - 0.45) * 0.4, 1)
        onsd_base = float(oc.get("onsd_mm", 5.52))
        if iop_bump > 0 and onsd_base < 6.1:
            onsd_base += iop_bump * 0.18
        onsd = round(onsd_base + 0.04 * circ + (_h(crew_id, minute, "onsd") - 0.5) * 0.04, 2)
        icp_base = float(oc.get("icp_mmhg", 13.8))
        if iop_bump > 0 and icp_base < 18.0:
            icp_base += iop_bump * 0.8
        icp = round(icp_base + 0.4 * circ + (_h(crew_id, minute, "icp") - 0.5) * 0.3, 1)
        shift_base = float(oc.get("fluid_shift_ml", 1680.0))
        if shift_bump > 0 and shift_base < 2050.0:
            shift_base += shift_bump
        shift = round(shift_base + 35.0 * circ + (_h(crew_id, minute, "fshift") - 0.5) * 20.0)
        return {
            "iop_mmhg": iop,
            "iop_od_mmhg": od,
            "iop_os_mmhg": os_val,
            "onsd_mm": onsd,
            "icp_mmhg": icp,
            "fluid_shift_ml": shift,
        }


def all_sim_adapters() -> list[DeviceAdapter]:
    return [AREDAdapter(), T2Adapter(), CEVISAdapter(), BioMonitorAdapter(), ActiwatchAdapter(),
            TMiniAdapter(), CO2Adapter(), DosimeterAdapter(), UWMSAdapter(), SLAMMDAdapter(), PVTAdapter(),
            PosturographyAdapter(), DXAAdapter(), GXTAdapter(), BloodLabAdapter(), SpaceTonometerAdapter()]
