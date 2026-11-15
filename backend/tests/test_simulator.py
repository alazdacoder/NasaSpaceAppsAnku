import numpy as np
import pytest

from app.config import load_config
from app.db import DB
from app.sim.model import CrewState, DayInputs, caox_supersaturation, simulate_day
from app.sim.world import World


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture()
def world(cfg):
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    return w


def _mean(w, cid, metric, lo, hi):
    days, vals = w.db.series(cid).get(metric, ([], []))
    sel = [v for d, v in zip(days, vals) if lo <= d <= hi]
    return sum(sel) / len(sel)


def test_seeded_runs_are_identical(cfg):
    a = World(cfg, DB(":memory:"), real_clock=lambda: 0.0)
    b = World(cfg, DB(":memory:"), real_clock=lambda: 0.0)
    a.bootstrap(start_day=5)
    b.bootstrap(start_day=5)
    assert a.db.series("c1") == b.db.series("c1")
    c = World(cfg, DB(":memory:"), seed=7, real_clock=lambda: 0.0)
    c.bootstrap(start_day=5)
    assert c.db.series("c1") != a.db.series("c1")


def test_shape_3_crew_10_baseline_days(world, cfg):
    assert len(world.crew_ids) == 3
    days, _ = world.db.series("c1")["u_volume"]
    assert days[0] == -10 and days[-1] == cfg["simulation"]["start_day"] - 1
    assert world.today == cfg["simulation"]["start_day"]
    assert world.landing_day == 180                        # in flight: days 0..179
    assert world.last_day == 180 + cfg["simulation"]["postflight_days"] - 1   # R+0 .. R+20 after landing


def test_flight_changes_match_reference_directions(world):
    for cid in ("c1", "c2"):
        assert _mean(world, cid, "u_calcium", 20, 29) > _mean(world, cid, "u_calcium", -10, -1) * 1.2
        assert _mean(world, cid, "u_citrate", 20, 29) < _mean(world, cid, "u_citrate", -10, -1)
        assert _mean(world, cid, "u_ph", 20, 29) < _mean(world, cid, "u_ph", -10, -1)
        assert _mean(world, cid, "sleep_h", 0, 29) < _mean(world, cid, "sleep_h", -10, -1)


def test_calcium_rise_bounded_near_50_percent_with_exercise(world):
    # c2 exercises normally: rise stays at or under ~50 %
    rise = _mean(world, "c2", "u_calcium", 25, 29) / _mean(world, "c2", "u_calcium", -10, -1) - 1
    assert 0.2 < rise < 0.55


def test_low_water_lowers_urine_volume_and_raises_stone_risk(cfg):
    prof = cfg["crew"][1]
    st1, st2 = CrewState(), CrewState()
    normal = simulate_day(cfg, 1, 1, prof, st1, 40, DayInputs())
    dry = simulate_day(cfg, 1, 1, prof, st2, 40, DayInputs(events=[{"kind": "dehydration", "params": {"water_factor": 0.5}}]))
    assert dry["urine"]["u_volume"] < normal["urine"]["u_volume"] - 0.5
    u_n, u_d = normal["urine"], dry["urine"]
    ss_n = caox_supersaturation(u_n["u_calcium"], u_n["u_oxalate"], u_n["u_citrate"], u_n["u_ph"], u_n["u_volume"])
    ss_d = caox_supersaturation(u_d["u_calcium"], u_d["u_oxalate"], u_d["u_citrate"], u_d["u_ph"], u_d["u_volume"])
    assert ss_d > ss_n
    assert dry["urine"]["u_sg"] > normal["urine"]["u_sg"]


def test_exercise_raises_water_need_and_lowers_urine_volume(cfg):
    prof = cfg["crew"][1]
    off = DayInputs(autopilot=False)
    on = DayInputs(autopilot=False, workout_tasks_done={"ared", "cardio"})
    a = simulate_day(cfg, 1, 1, prof, CrewState(), 40, off)
    b = simulate_day(cfg, 1, 1, prof, CrewState(), 40, on)
    assert b["ex_min"] > 60 and a["ex_min"] == 0
    assert b["urine"]["u_volume"] < a["urine"]["u_volume"] + 0.1 * (b["water_l"] - a["water_l"])
    assert any(s["avg_hr"] > prof["hr_rest"] + 30 for s in b["sessions"])


def test_protocol_effect_scales_with_adherence_and_response_factor(cfg):
    good = dict(cfg["crew"][0], response_factor=1.0)
    poor = dict(cfg["crew"][0], response_factor=0.25)
    proto = [{"id": 1, "type": "potassium_citrate", "start_day": 30}]

    def run(prof, autopilot, confirm):
        st = CrewState()
        out = None
        for d in range(30, 45):
            inp = DayInputs(autopilot=autopilot, protocols=proto, doses_confirmed={1} if confirm else set())
            out = simulate_day(cfg, 3, 0, prof, st, d, inp)
        return out["urine"]["u_citrate"], st.adherence[1]

    cit_good, adh_good = run(good, False, True)
    cit_poor, _ = run(poor, False, True)
    cit_none, adh_none = run(good, False, False)
    assert adh_good > 0.95 and adh_none == 0.0
    assert cit_good - cit_none > 100                     # ~ +135 mg/day at full adherence
    assert cit_good - cit_poor > 70                      # poor responder gets much less


def test_scripted_events_present(world):
    kinds = {(e["crew_id"], e["kind"]) for e in world.events_for()}
    assert ("c2", "dehydration") in kinds
    assert ("c3", "poor_sleep") in kinds
    assert ("c2", "missed_workouts") in kinds
    # dehydration lowers c2 urine volume during the event
    assert _mean(world, "c2", "u_volume", 27, 29) < _mean(world, "c2", "u_volume", 10, 20) - 0.4


def test_default_seed_demo_states(world):
    c1 = world.evaluation("c1")
    assert any(a["id"] == "stone_risk" for a in c1["alerts"])                  # high stone-risk crew member
    assert any(t["task_id"] == "supplement_start:potassium_citrate" for t in world.tasks("c1"))
    c3 = world.evaluation("c3")
    assert c3["protocols"] and c3["protocols"][0]["score"] < 0.35               # poor responder
    assert any(a["id"] == "protocol:1" for a in c3["alerts"])
    c2 = world.evaluation("c2")
    assert any(a["id"] == "bone_loss" for a in c2["alerts"])                   # cross-source rule


def test_supplement_task_flow_raises_response_score(world):
    world.confirm_task("c1", "supplement_start:potassium_citrate")
    proto = world.evaluation("c1")["protocols"]
    assert proto and proto[0]["started_by"] == "crew"
    world.advance(10)
    score = world.evaluation("c1")["protocols"][0]["score"]
    assert score is not None and score > 0.5


def test_tasks_finalize_and_regenerate(world):
    world.confirm_task("c2", "water")
    world.advance(1)
    rows = world.db.all("SELECT task_id, status FROM tasks WHERE crew_id='c2' AND day=30")
    status = {r["task_id"]: r["status"] for r in rows}
    assert status["water"] == "done"
    assert status["workout:ared"] in ("auto", "missed")
    assert world.tasks("c2")                       # new day has tasks


def test_live_workout_logs_session(cfg):
    t = [1000.0]
    w = World(cfg, DB(":memory:"), real_clock=lambda: t[0])
    w.bootstrap()
    w.set_speed(0)
    w.start_workout("c1", "cevis", {"watts": 180})
    for _ in range(30):
        t[0] += 1
        w.tick()
    view = w.workout_view("c1")
    assert view["hr"] > w.profiles["c1"]["hr_rest"] + 30
    summary = w.finish_workout("c1")
    assert summary["minutes"] == pytest.approx(5.0, abs=0.2)     # 30 real s x10 scale
    assert any(x["task_id"] == "workout:cardio" and x["status"] == "done" for x in w.tasks("c1"))


def test_ground_link_delays_surgeon_data(cfg):
    t = [1000.0]
    w = World(cfg, DB(":memory:"), real_clock=lambda: t[0])
    w.bootstrap()
    w.set_speed(0)
    w.link.set_profile("mars", delay_s=600)
    before = w.db.one("SELECT seq FROM g_state WHERE crew_id='c1'")["seq"]
    w.send_snapshots()
    t[0] += 1
    w.tick()
    assert w.db.one("SELECT seq FROM g_state WHERE crew_id='c1'")["seq"] == before   # still in flight
    assert w.link.status()["in_flight"] > 0
    t[0] += 601
    w.link.pump()
    assert w.db.one("SELECT seq FROM g_state WHERE crew_id='c1'")["seq"] > before
