"""Energy, behavioural health, return to Earth (vestibular), languages and the ground view."""
import json

import pytest

from app.config import load_config
from app.db import DB
from app.engine.vestibular import readiness_level
from app.i18n import localize
from app.sim.model import (CrewState, DayInputs, day_schedule, kcal_per_min, landing_effects, planned_sessions,
                           simulate_day, work_hours)
from app.sim.world import World


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture()
def world(cfg):
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    return w


@pytest.fixture(scope="module")
def landed(cfg):
    """One world fast-forwarded to a week after landing (shared: it takes a few seconds)."""
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    w.jump_to(w.landing_day + 7)
    return w


# ------------------------------------------------------------------ energy
def test_exercise_energy_follows_machine_settings(cfg):
    assert kcal_per_min(cfg, "ared", {"load_kg": 140}, 70) > kcal_per_min(cfg, "ared", {"load_kg": 60}, 70)
    assert kcal_per_min(cfg, "t2", {"speed_kmh": 12, "harness_kg": 50}, 70) > kcal_per_min(cfg, "t2", {"speed_kmh": 8, "harness_kg": 50}, 70)
    assert kcal_per_min(cfg, "t2", {"speed_kmh": 10, "harness_kg": 60}, 70) > kcal_per_min(cfg, "t2", {"speed_kmh": 10, "harness_kg": 35}, 70)
    # CEVIS: watts / gross efficiency -> 150 W is about 10 kcal/min
    assert kcal_per_min(cfg, "cevis", {"watts": 150}, 70) == pytest.approx(150 * 60 / 4186 / 0.21, rel=1e-6)


def test_day_energy_adds_up_and_moves_body_mass(cfg):
    prof = cfg["crew"][1]
    st = CrewState()
    out = simulate_day(cfg, 1, 1, prof, st, 40, DayInputs(autopilot=False, workout_tasks_done={"ared", "cardio"}))
    acts = out["activities"]
    assert sum(a["kcal"] for a in acts) == pytest.approx(out["energy"]["kcal_out"], abs=0.5)
    assert sum(a["minutes"] for a in acts) == pytest.approx(24 * 60, abs=10)
    ex = [a for a in acts if a["kind"] == "exercise"]
    assert {a["device"] for a in ex} == {"ared", "t2"}
    assert out["energy"]["kcal_exercise"] == pytest.approx(sum(a["kcal"] for a in ex), abs=0.5)
    balance = out["food"]["kcal"] - out["energy"]["kcal_out"]
    assert st.mass == pytest.approx(prof["mass_kg"] + balance / cfg["energy"]["kcal_per_kg_body_mass"])
    # skipping exercise burns less
    rest = simulate_day(cfg, 1, 1, prof, CrewState(), 40, DayInputs(autopilot=False))
    assert rest["energy"]["kcal_out"] < out["energy"]["kcal_out"] - 300


def test_live_workout_counts_energy(cfg):
    t = [1000.0]
    w = World(cfg, DB(":memory:"), real_clock=lambda: t[0])
    w.bootstrap()
    w.set_speed(0)
    w.start_workout("c1", "cevis", {"watts": 180})
    for _ in range(30):
        t[0] += 1
        w.tick()
    view = w.workout_view("c1")
    expected = kcal_per_min(cfg, "cevis", {"watts": 180}, w.mass("c1")) * 5.0      # 30 real s x10 = 5 min
    assert view["kcal"] == pytest.approx(expected, rel=0.02)
    summary = w.finish_workout("c1")
    assert summary["kcal"] == pytest.approx(expected, rel=0.02)
    today = w.energy_today("c1")
    cardio = next(b for b in today["blocks"] if b.get("slot") == "cardio")
    assert cardio["status"] == "done" and cardio["kcal_total"] == pytest.approx(summary["kcal"], rel=0.01)


def test_energy_today_runs_with_the_clock(world):
    e = world.energy_today("c1")
    assert 0 < e["kcal_so_far"] < e["kcal_expected"]
    statuses = [b["status"] for b in e["blocks"]]
    assert statuses[0] == "done" and "now" in statuses and statuses[-1] == "next"


def test_eva_day_replaces_ared_and_raises_workload(cfg):
    normal = day_schedule(cfg, 40, {}, 0.5, 0)
    eva = day_schedule(cfg, 40, {"eva": {}}, 0.5, 0)
    assert any(b["kind"] == "eva" for b in eva)
    assert not any(b.get("slot") == "ared" for b in eva)
    assert [p["slot"] for p in planned_sessions(cfg, 40, eva=True)] == ["cardio"]
    assert work_hours(cfg, eva) > 10 > work_hours(cfg, normal)


# ------------------------------------------------------- behavioural health
def test_mars_delay_rules_out_live_family_calls(cfg):
    call_day = 7          # (day + crew_idx) % 7 == 0 for crew 0
    assert any(b["kind"] == "family_call" for b in day_schedule(cfg, call_day, {}, 0.5, 0))
    assert not any(b["kind"] == "family_call" for b in day_schedule(cfg, call_day, {}, 1320, 0))


def test_default_seed_mind_states(world):
    alerts = {cid: {a["id"] for a in world.evaluation(cid)["alerts"]} for cid in world.crew_ids}
    assert "cognitive_fatigue" in alerts["c3"]          # poor-sleep week slows reaction time
    assert "workload_stress" in alerts["c2"]            # scripted high-workload week
    assert "isolation_strain" in alerts["c4"]           # scripted isolation week
    ev = world.evaluation("c3")["metrics"]["pvt_rt_ms"]
    assert ev["z"] > 1.5


def test_checkin_and_reaction_test_become_the_days_values(world):
    world.add_manual("c1", "checkin", {"feeling": 2, "stress": 5, "tiredness": 4, "connection": 1})
    world.add_manual("c1", "pvt", {"mean_rt_ms": 412, "lapses": 6, "trials": 10})
    assert next(t for t in world.tasks("c1") if t["task_id"] == "checkin")["status"] == "done"
    day = world.today
    world.advance(1)
    s = world.series("c1")
    val = {m: dict(zip(*s[m]))[day] for m in ("feeling", "stress", "tiredness", "connection", "pvt_rt_ms", "pvt_lapses", "wellbeing")}
    assert (val["feeling"], val["stress"], val["tiredness"], val["connection"]) == (2, 5, 4, 1)
    assert (val["pvt_rt_ms"], val["pvt_lapses"]) == (412, 6)
    assert val["wellbeing"] == pytest.approx((1 / 4 + 0 + 1 / 4 + 0) / 4 * 100)
    with pytest.raises(ValueError):
        world.add_manual("c1", "checkin", {"feeling": 9, "stress": 1, "tiredness": 1, "connection": 1})


# --------------------------------------------------------- return to Earth
def test_pre_landing_training_lowers_landing_effects(cfg):
    prof = cfg["crew"][1]
    none = landing_effects(cfg, prof, 0, 1.0)
    full = landing_effects(cfg, prof, cfg["vestibular"]["prelanding_training_days"], 1.0)
    assert full["sot_drop"] == pytest.approx(none["sot_drop"] * (1 - cfg["vestibular"]["training_benefit"]))
    assert full["days_to_baseline"] < none["days_to_baseline"]
    fitter = landing_effects(cfg, prof, 0, 1.2)
    assert fitter["ortho_rise"] < none["ortho_rise"]


def test_readiness_levels(cfg):
    assert readiness_level(cfg, -40, 2, 9) == 0
    assert readiness_level(cfg, -25, 4, 5) == 1
    assert readiness_level(cfg, -15, 6, 3) == 2
    assert readiness_level(cfg, -3, 9, 0) == 4


def test_balance_drops_on_landing_and_recovers(landed):
    w = landed
    L = w.landing_day
    for cid in w.crew_ids:
        s = w.series(cid)
        sot = dict(zip(*s["vest_sot"]))
        base = sum(v for d, v in sot.items() if d < 0) / len([d for d in sot if d < 0])
        assert sot[L] < base * 0.9                                  # clear drop on landing day
        assert sot[L + 6] > sot[L] + 5                              # recovering a week later
        ready = dict(zip(*s["vest_readiness"]))
        assert ready[L + 6] >= ready[L] and ready[L] <= 2
        assert "vest_sot" not in {m for m, (d, _) in s.items() if any(0 <= x < L for x in d)}   # no balance tests in flight
    # Daniel (c2): first flight, high susceptibility -> slowest recovery
    slow = dict(zip(*w.series("c2")["vest_readiness"]))
    fast = dict(zip(*w.series("c1")["vest_readiness"]))
    assert sum(slow[L + i] for i in range(4)) < sum(fast[L + i] for i in range(4))


def test_post_flight_rules_and_tasks(cfg):
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    w.jump_to(w.landing_day + 1)
    ids = {a["id"] for a in w.evaluation("c2")["alerts"]}
    assert "vestibular_dysfunction" in ids
    assert "bone_loss" not in ids and "metric:ex_week_min" not in ids     # in-flight-only rules are off
    tasks = {t["task_id"] for t in w.tasks("c2")}
    assert {"workout:rehab", "vest_rehab", "dizziness"} <= tasks and "workout:ared" not in tasks
    with pytest.raises(ValueError):
        w.start_workout("c2", "ared", {})
    assert w.start_workout("c2", "rehab", {})["active"]


def test_pre_landing_training_tasks_appear_two_weeks_before_landing(cfg):
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    assert "prelanding" not in {t["task_id"] for t in w.tasks("c1")}
    w.jump_to(w.landing_day - 14)
    assert "prelanding" in {t["task_id"] for t in w.tasks("c1")}


# ---------------------------------------------------------------- languages
def test_localize_swaps_and_drops_turkish_twins():
    obj = {"title": "Stress", "title_tr": "Stres", "recs": ["a"], "recs_tr": ["b"], "n": 1,
           "items": [{"label": "Sleep", "label_tr": "Uyku"}, {"label": "Only English"}]}
    assert localize(obj, "en") == {"title": "Stress", "recs": ["a"], "n": 1, "items": [{"label": "Sleep"}, {"label": "Only English"}]}
    assert localize(obj, "tr") == {"title": "Stres", "recs": ["b"], "n": 1, "items": [{"label": "Uyku"}, {"label": "Only English"}]}


def test_every_metric_rule_and_recommendation_has_turkish(cfg):
    for mid, m in cfg["metrics"].items():
        assert m.get("label_tr") and m.get("meaning_tr"), mid
    for rid, r in cfg["recommendations"].items():
        assert r.get("text_tr"), rid
    for r in cfg["cross_rules"]:
        assert r.get("title_tr") and r.get("reason_tr"), r["id"]
        assert set(__import__("re").findall(r"\{[^}]+\}", r["reason"])) == set(__import__("re").findall(r"\{[^}]+\}", r["reason_tr"])), r["id"]


def test_api_speaks_turkish_and_lab_view_lags(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        c.post("/api/demo/speed", json={"day_seconds": 0})
        en = c.get("/api/crew/c1/today").json()
        tr = c.get("/api/crew/c1/today", headers={"X-Lang": "tr"}).json()
        assert en["alerts"][0]["title"] == "Kidney-stone risk is high"
        assert tr["alerts"][0]["title"] == "Böbrek taşı riski yüksek"
        assert "_tr\"" not in json.dumps(tr) and "_tr\"" not in json.dumps(en)
        assert c.get("/api/crew/c3/mind?lang=tr").json()["alerts"][0]["title"].startswith("Kötü uykudan")
        for path in ("energy", "mind", "return", "body", "lab", "exercise", "nutrition", "environment", "alerts"):
            assert c.get(f"/api/crew/c2/{path}?side=ground").status_code == 200, path
        # Mars delay: the onboard day moves on, the ground copy does not until packets arrive
        c.post("/api/demo/profile", json={"profile": "mars", "delay_s": 600})
        c.post("/api/demo/skip", json={"days": 1})
        crew_view = c.get("/api/crew/c1/mind").json()["view"]
        ground_view = c.get("/api/crew/c1/mind?side=ground").json()["view"]
        assert ground_view["side"] == "ground" and ground_view["data_day"] < crew_view["data_day"]
        c.post("/api/demo/profile", json={"profile": "iss"})
