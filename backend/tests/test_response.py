import math

import pytest

from app.engine.response import days_to_target, fit_exponential, progress, protocol_response


def test_progress_formula_matches_spec():
    # progress = 1 - |current - target| / |start - target|
    assert progress(400, 400, 535) == 0.0
    assert progress(535, 400, 535) == 1.0
    assert progress(467.5, 400, 535) == pytest.approx(0.5)
    # works for falling targets too
    assert progress(2.5, 3.0, 2.0) == pytest.approx(0.5)


def test_progress_is_clipped_to_0_1():
    assert progress(300, 400, 535) == 0.0          # moved the wrong way
    assert progress(700, 400, 535) == 0.0          # overshoot past 2x span, plain formula
    assert progress(560, 400, 535) == pytest.approx(1 - 25 / 135)


def test_stop_at_target_counts_overshoot_as_reached():
    assert progress(600, 400, 535, direction="up", stop_at_target=True) == 1.0
    assert progress(600, 400, 535, direction="up", stop_at_target=False) < 1.0
    assert progress(1.8, 3.0, 2.0, direction="down", stop_at_target=True) == 1.0


def test_zero_span_is_full_progress():
    assert progress(5.0, 5.0, 5.0) == 1.0


def test_exponential_fit_recovers_parameters():
    tau, pmax = 4.0, 1.0
    days = list(range(1, 15))
    prog = [pmax * (1 - math.exp(-t / tau)) for t in days]
    fit = fit_exponential(days, prog)
    assert fit is not None
    assert fit[0] == pytest.approx(pmax, rel=0.05)
    assert fit[1] == pytest.approx(tau, rel=0.1)
    dtt = days_to_target(days, prog, fraction=0.9)
    assert dtt == pytest.approx(-tau * math.log(0.1), rel=0.1)


def test_days_to_target_none_when_plateau_below_target():
    days = list(range(1, 15))
    prog = [0.3 * (1 - math.exp(-t / 3)) for t in days]       # poor responder
    assert days_to_target(days, prog, fraction=0.9) is None


def test_days_to_target_needs_three_points():
    assert days_to_target([1, 2], [0.2, 0.4]) is None


def test_protocol_response_uses_smoothed_start_and_delta_target():
    days = list(range(-5, 11))
    ewma_vals = [400.0] * 5 + [400.0 + 135 * (1 - math.exp(-(d + 1) / 3)) for d in range(0, 11)]
    series = {"u_citrate": {"days": days, "ewma": ewma_vals}}
    targets = [{"metric": "u_citrate", "mode": "delta", "value": 135, "direction": "up"}]
    res = protocol_response(series, targets, start_day=0, today=10)
    t = res["targets"][0]
    assert t["start"] == 400.0
    assert t["target"] == 535.0
    assert 0.9 < res["score"] <= 1.0
    # progress rises over time
    hist = [h["progress"] for h in t["history"]]
    assert hist == sorted(hist)
