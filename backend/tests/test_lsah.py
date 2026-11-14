"""LSAH structure: catalog, MR089S annual-exam rules, the mission test schedule and the five-crew roster."""
from datetime import date

import pytest

from app.config import load_config
from app.db import DB
from app.engine import lsah as L
from app.engine.lsah import annual_plan
from app.sim.world import World


@pytest.fixture(scope="module")
def cfg():
    return load_config()


@pytest.fixture(scope="module")
def landed(cfg):
    w = World(cfg, DB(":memory:"), real_clock=lambda: 1000.0)
    w.bootstrap()
    w.jump_to(w.landing_day + 16)
    return w


def test_five_fictional_crew_with_lsah_fields(cfg):
    crew = cfg["crew"]
    assert len(crew) == 5
    old = {"Lena Okafor", "Marco Diaz", "Yuki Tanaka", "Sam Novak"}
    assert not old & {c["name"] for c in crew}
    assert [c["name"] for c in crew] == [f"Astronaut {i}" for i in range(1, 6)]
    assert [c["name_tr"] for c in crew] == [f"Astronot {i}" for i in range(1, 6)]
    for c in crew:
        assert c["sex"] in ("F", "M") and len(c["birth"]) == 7 and c["flights"] >= 1
        assert set(c["lsah"]) == {"bmd_hip", "vo2peak", "vitd_serum", "hemoglobin"}


def test_catalog_is_complete_and_bilingual(cfg):
    cat = cfg["lsah"]["catalog"]
    assert len(cat) == 50
    ids = {c["id"] for c in cat}
    for c in cat:
        assert c["title_tr"] and c["variables_tr"]
        for m in c["app_metrics"]:
            assert m in cfg["metrics"], m
    for t in cfg["lsah"]["mission_tests"]["tests"]:
        assert t["category_id"] in ids
    titles = {c["id"]: c["title"] for c in cat}
    assert titles[36] == "Bone Densitometry (DXA)"
    assert next(c for c in cat if c["id"] == 36)["phases"] == {"pre": True, "in": False, "post": True, "annual": "Every 3 yr."}


def _due(cfg, sex, birth, ref, last_dxa=2026):
    prof = {"sex": sex, "birth": birth, "last_dxa_year": last_dxa}
    return {i["id"] for i in annual_plan(cfg, prof, ref)["items"] if i["due"]}


def test_mr089s_annual_exam_rules(cfg):
    ref = date(2027, 3, 1)
    # graded exercise test at ages 30, 35, 40; every 2 years 40-50; every year after 50
    assert "gxt" in _due(cfg, "M", "1997-06", ref)        # 30
    assert "gxt" not in _due(cfg, "M", "1996-06", ref)    # 31
    assert "gxt" in _due(cfg, "M", "1985-06", ref)        # 42
    assert "gxt" not in _due(cfg, "M", "1984-06", ref)    # 43
    assert "gxt" in _due(cfg, "M", "1974-06", ref)        # 53
    # sex- and age-specific items
    assert "psa" in _due(cfg, "M", "1980-06", ref) and "psa" not in _due(cfg, "M", "1995-06", ref)
    assert "pap" in _due(cfg, "F", "1990-06", ref) and "pap" not in _due(cfg, "M", "1990-06", ref)
    assert "mammo" in _due(cfg, "F", "1985-06", ref) and "mammo" not in _due(cfg, "F", "1984-06", ref)
    assert "colon" in _due(cfg, "M", "1977-06", ref)      # 50
    # DXA every 3 years
    assert "dxa" in _due(cfg, "F", "1990-06", ref, last_dxa=2024)
    assert "dxa" not in _due(cfg, "F", "1990-06", ref, last_dxa=2026)
    # the exam month is the next birth month
    assert annual_plan(cfg, {"sex": "F", "birth": "1990-02", "last_dxa_year": 2026}, ref)["month"] == "2028-02"
    assert annual_plan(cfg, {"sex": "F", "birth": "1990-03", "last_dxa_year": 2026}, ref)["month"] == "2027-03"


def test_tests_run_only_on_their_days(cfg, landed):
    w = landed
    for t in cfg["lsah"]["mission_tests"]["tests"]:
        days = L.test_days(cfg, t)
        for m in t["metrics"]:
            got = w.series("c1")[m][0]
            assert got == [d for d in days if d <= w.last_closed_day], (t["id"], m)
    assert [t["id"] for t in L.tests_on(cfg, 30)] == ["blood_draw"]


def test_lsah_tests_follow_the_crew_stories(landed):
    w = landed
    s = {cid: w.series(cid) for cid in w.crew_ids}
    # Astronaut 3 (c3) skips the vitamin D tablet: lower in flight than before
    vd = dict(zip(*s["c3"]["vitd_serum"]))
    assert vd[150] < vd[-9] - 3
    # Astronaut 4 (c4) missed resistance exercise twice: the largest hip bone loss
    loss = {cid: 1 - w.state[cid].bmd_frac for cid in w.crew_ids}
    assert max(loss, key=loss.get) == "c4"
    assert any(a["id"] == "metric:bmd_hip" for a in w.evaluation("c4")["alerts"])
    # hemoglobin dips in flight ("space anemia") and recovers after landing
    hb = dict(zip(*s["c5"]["hemoglobin"]))
    assert hb[60] < hb[-9] and hb[w.landing_day + 14] > hb[w.landing_day]


def test_lsah_api(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "hub.db"))
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        c.post("/api/demo/speed", json={"day_seconds": 0})
        cat = c.get("/api/lsah", headers={"X-Lang": "tr"}).json()
        assert len(cat["catalog"]) == 50 and cat["catalog"][35]["title"] == "Kemik yoğunluğu ölçümü (DXA)"
        r = c.get("/api/crew/c4/lsah").json()
        assert r["profile"]["age"] == 51 and r["annual"]["month"] == "2027-06" and r["annual"]["in_flight"]
        assert {"gxt", "psa", "dxa"} <= {i["id"] for i in r["annual"]["items"] if i["due"]}
        blood = next(t for t in r["tests"] if t["id"] == "blood_draw")
        assert blood["next"]["day"] == 30 and blood["next"]["status"] == "today"
        assert c.get("/api/crew/c2/lsah?side=ground").status_code == 200
        assert any(t["task_id"] == "lsah:blood_draw" for t in c.get("/api/crew/c1/today").json()["tasks"])
