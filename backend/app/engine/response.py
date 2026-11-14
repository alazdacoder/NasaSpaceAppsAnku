"""Protocol response score.

progress = 1 - |current - target| / |start - target|, clipped to 0..1, computed on
EWMA-smoothed values. Days to target come from fitting an exponential approach
p(t) = p_max * (1 - exp(-t / tau)) to the progress series since the protocol started.

This measures how far a urine marker has moved toward its target. It is NOT a
measure of bioavailability.
"""
from __future__ import annotations

import math
from typing import Sequence


def progress(current: float, start: float, target: float, *, direction: str | None = None,
             stop_at_target: bool = False) -> float:
    """Response progress for one marker, clipped to 0..1.

    With stop_at_target, a value past the target in the wanted direction counts as 1.0
    (otherwise the plain formula would penalise overshoot).
    """
    span = abs(start - target)
    if span == 0:
        return 1.0
    if stop_at_target and direction in ("up", "down"):
        if (direction == "up" and current >= target) or (direction == "down" and current <= target):
            return 1.0
    p = 1.0 - abs(current - target) / span
    return min(1.0, max(0.0, p))


def fit_exponential(days: Sequence[float], prog: Sequence[float]) -> tuple[float, float] | None:
    """Fit p(t) = p_max * (1 - exp(-t/tau)). Returns (p_max, tau) or None if too few points.

    Grid search over tau with closed-form least-squares p_max for each tau.
    """
    pts = [(t, p) for t, p in zip(days, prog) if t >= 0]
    if len(pts) < 3 or max(t for t, _ in pts) <= 0:
        return None
    best: tuple[float, float, float] | None = None
    tau = 0.5
    while tau <= 120:
        basis = [1 - math.exp(-t / tau) for t, _ in pts]
        bb = sum(b * b for b in basis)
        if bb > 0:
            pmax = sum(b * p for b, (_, p) in zip(basis, pts)) / bb
            pmax = max(0.0, pmax)
            sse = sum((pmax * b - p) ** 2 for b, (_, p) in zip(basis, pts))
            if best is None or sse < best[0]:
                best = (sse, pmax, tau)
        tau *= 1.08
    if best is None:
        return None
    return best[1], best[2]


def days_to_target(days: Sequence[float], prog: Sequence[float], fraction: float = 0.9) -> float | None:
    """Estimated days from protocol start until progress reaches `fraction`.

    Returns None when there is not enough data or the fitted curve levels off below
    `fraction` (the protocol is not on track to reach its target).
    """
    fit = fit_exponential(days, prog)
    if fit is None:
        return None
    pmax, tau = fit
    if pmax <= fraction:
        return None
    return -tau * math.log(1 - fraction / pmax)


def protocol_response(series: dict[str, dict], targets: list[dict], start_day: int, today: int,
                      stop_at_target: bool = True, fraction: float = 0.9) -> dict:
    """Score a protocol.

    series: metric -> {"days": [...], "ewma": [...]} (EWMA-smoothed daily values).
    targets: protocol targets from config ({metric, mode: delta|absolute, value, direction}).
    """
    per_target = []
    for tgt in targets:
        s = series.get(tgt["metric"])
        if not s or not s["days"]:
            continue
        pairs = list(zip(s["days"], s["ewma"]))
        before = [v for d, v in pairs if d < start_day]
        after = [(d, v) for d, v in pairs if start_day <= d <= today]
        if not before or not after:
            continue
        start_val = before[-1]
        target_val = start_val + tgt["value"] if tgt.get("mode", "delta") == "delta" else tgt["value"]
        prog = [progress(v, start_val, target_val, direction=tgt.get("direction"), stop_at_target=stop_at_target)
                for _, v in after]
        t_rel = [d - start_day + 1 for d, _ in after]   # day of start counts as day 1 of exposure
        dtt = days_to_target(t_rel, prog, fraction)
        per_target.append({
            "metric": tgt["metric"],
            "label": tgt.get("label", tgt["metric"]),
            "start": start_val,
            "target": target_val,
            "current": after[-1][1],
            "progress": prog[-1],
            "history": [{"day": d, "progress": p} for (d, _), p in zip(after, prog)],
            "days_to_target": dtt,
            "days_since_start": today - start_day + 1,
            "source": tgt.get("source"),
            "verified": tgt.get("verified", False),
        })
    score = sum(t["progress"] for t in per_target) / len(per_target) if per_target else None
    remaining = [t["days_to_target"] for t in per_target]
    if per_target and all(r is not None for r in remaining):
        est_total = max(remaining)
        est_left = max(0.0, est_total - (today - start_day + 1))
    else:
        est_total = est_left = None
    return {"score": score, "targets": per_target, "days_to_target_total": est_total,
            "days_to_target_left": est_left}
