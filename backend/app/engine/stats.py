"""Small, dependency-light statistics used by the rules engine."""
from __future__ import annotations

import math
from typing import Sequence


def ewma(values: Sequence[float], alpha: float) -> list[float]:
    """Exponentially weighted moving average. s0 = x0; s_t = a*x_t + (1-a)*s_{t-1}."""
    if not 0 < alpha <= 1:
        raise ValueError("alpha must be in (0, 1]")
    out: list[float] = []
    s: float | None = None
    for x in values:
        s = x if s is None else alpha * x + (1 - alpha) * s
        out.append(s)
    return out


def mean_sd(values: Sequence[float], min_sd: float = 0.0) -> tuple[float, float]:
    """Mean and sample standard deviation, with a floor so tiny baselines don't explode z."""
    n = len(values)
    if n == 0:
        raise ValueError("empty baseline")
    m = sum(values) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in values) / (n - 1)) if n > 1 else 0.0
    return m, max(sd, min_sd)


def zscore(value: float, mean: float, sd: float) -> float:
    return 0.0 if sd <= 0 else (value - mean) / sd


def slope(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Least-squares slope of ys against xs (units of y per unit of x)."""
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx


def pct_change(value: float, base: float) -> float:
    return 0.0 if base == 0 else 100.0 * (value - base) / abs(base)


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)
