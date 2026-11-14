import copy

import pytest

from app.config import load_config, unverified_items
from app.engine.rules import evaluate_crew, evaluate_cross_rule, evaluate_metric
from app.engine.stats import ewma, mean_sd, slope, zscore


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def test_ewma_basic():
    assert ewma([10, 20], 0.5) == [10, 15]
    assert ewma([1, 1, 1], 0.3) == [1, 1, 1]


def test_mean_sd_floor_and_z():
    m, sd = mean_sd([5, 5, 5], min_sd=0.5)
    assert m == 5 and sd == 0.5
    assert zscore(6, 5, 0.5) == 2.0


def test_slope():
    assert slope([0, 1, 2, 3], [1, 3, 5, 7]) == pytest.approx(2.0)
    assert slope([1], [1]) == 0.0


def _series(base, flight, base_days=10):
    days = list(range(-base_days, 0)) + list(range(0, len(flight)))
    return days, list(base) + list(flight)


def test_urine_volume_thresholds_from_config(cfg):
    mdef = cfg["metrics"]["u_volume"]
    days, vals = _series([2.6] * 10, [1.6] * 10)
    ev = evaluate_metric("u_volume", mdef, days, vals, cfg["defaults"], today=9)
    assert ev["status"] == "red"
    assert any("below 2.0" in t["reason"] for t in ev["triggered"])
    assert all(t["verified"] for t in ev["triggered"])
    days, vals = _series([2.6] * 10, [2.3] * 10)
    assert evaluate_metric("u_volume", mdef, days, vals, cfg["defaults"], today=9)["status"] == "amber"
    days, vals = _series([2.6] * 10, [2.8] * 10)
    assert evaluate_metric("u_volume", mdef, days, vals, cfg["defaults"], today=9)["status"] == "green"


def test_metric_output_has_baseline_z_slope_anomaly(cfg):
    mdef = cfg["metrics"]["hr_rest"]
    days, vals = _series([60, 61, 59, 60, 60, 61, 59, 60, 60, 60], [60, 60, 60, 62, 64, 66, 68, 70, 72, 90])
    ev = evaluate_metric("hr_rest", mdef, days, vals, cfg["defaults"], today=9)
    assert ev["baseline_mean"] == pytest.approx(60, abs=0.5)
    assert ev["z"] > 3
    assert ev["slope"] > 0
    assert ev["anomaly"] is True          # 90 bpm jump vs smoothed trend
    assert ev["status"] == "red"
    assert ev["triggered"][0]["reason"]


def test_pct_rule_on_calcium(cfg):
    mdef = cfg["metrics"]["u_calcium"]
    days, vals = _series([200] * 10, [320] * 15)     # +60 %
    ev = evaluate_metric("u_calcium", mdef, days, vals, cfg["defaults"], today=14)
    assert ev["status"] == "amber"
    assert "+60%" in ev["triggered"][0]["reason"]


def test_cross_rule_stone_risk(cfg):
    rule = next(r for r in cfg["cross_rules"] if r["id"] == "stone_risk")
    evals = {
        "caox_ss": {"value": 2.6, "ewma": 2.5, "z": 3, "slope": 0.1, "pct": 50, "decimals": 2, "stale": False},
        "u_volume": {"value": 1.7, "ewma": 1.8, "z": -3, "slope": 0, "pct": -30, "decimals": 2, "stale": False},
    }
    hit = evaluate_cross_rule(rule, evals)
    assert hit and hit["level"] == "red"
    assert "2.50" in hit["reason"] and "1.80" in hit["reason"]
    evals["u_volume"]["ewma"] = 2.3
    assert evaluate_cross_rule(rule, evals) is None


def test_cross_rule_bone_loss_needs_both_sources(cfg):
    rule = next(r for r in cfg["cross_rules"] if r["id"] == "bone_loss")
    low_ex = {"value": 90, "ewma": 90, "z": None, "slope": -5, "pct": None, "decimals": 0, "stale": False}
    rising = {"value": 320, "ewma": 310, "z": 4, "slope": 3.0, "pct": 45, "decimals": 0, "stale": False}
    flat = dict(rising, slope=0.0)
    assert evaluate_cross_rule(rule, {"ared_week_min": low_ex, "u_calcium": rising})
    assert evaluate_cross_rule(rule, {"ared_week_min": low_ex, "u_calcium": flat}) is None
    assert evaluate_cross_rule(rule, {"ared_week_min": dict(low_ex, value=300), "u_calcium": rising}) is None


def test_evaluate_crew_overall_and_recommendations_have_reasons(cfg):
    series = {
        "u_volume": _series([2.6] * 10, [1.7] * 10),
        "caox_ss": _series([1.4] * 10, [2.6] * 10),
    }
    ev = evaluate_crew(cfg, series, today=9)
    assert ev["overall"] == "red"
    assert ev["alerts"][0]["id"] == "stone_risk"      # cross-source alerts sort first
    for a in ev["alerts"]:
        assert a["reason"]
        for r in a["recs"]:
            assert r["id"] in cfg["recommendations"]
            assert r["text"] and "verified" in r


def test_protocol_rule_flags_poor_response(cfg):
    pr = {"protocol_id": 1, "label": "Potassium citrate", "score": 0.1, "days_since_start": 20,
          "targets": [{"metric": "u_citrate"}]}
    ev = evaluate_crew(cfg, {}, today=30, protocol_results=[pr])
    assert any(a["id"] == "protocol:1" for a in ev["alerts"])
    ev = evaluate_crew(cfg, {}, today=30, protocol_results=[dict(pr, score=0.8)])
    assert not ev["alerts"]


def test_config_requires_source_and_verified(cfg):
    from app.config import _validate
    bad = copy.deepcopy(cfg)
    del bad["metrics"]["u_volume"]["rules"][0]["source"]
    with pytest.raises(ValueError):
        _validate(bad)


def test_reference_values_are_exact(cfg):
    refs = {r["id"]: r for r in cfg["references"]}
    assert refs["ared_peak_load"]["value"] == 272
    assert refs["t2_peak_speed"]["value"] == 19.3
    assert refs["energy_intake"]["value"] == 2296 and refs["energy_intake"]["sd"] == 449
    assert refs["exercise_minutes_per_week"]["range"] == [450, 720]
    assert all(r["verified"] for r in cfg["references"])


def test_unverified_list_is_not_empty_and_has_sources(cfg):
    items = unverified_items(cfg)
    assert items
    assert all(i["source"] for i in items)
