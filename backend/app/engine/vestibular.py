"""Return-to-Earth readiness and balance recovery, driven by config `readiness`.

Readiness is the highest level whose conditions all hold: balance score (% vs the
preflight baseline), tandem-walk steps and dizziness. Recovery progress reuses the
protocol response idea: progress = 1 - |current - baseline| / |landing - baseline|,
and days to 90 % come from the same exponential fit.
"""
from __future__ import annotations

from typing import Any

from .response import days_to_target, progress
from .stats import ewma


def readiness_level(cfg: dict, sot_pct: float | None, tandem: float | None, dizzy: float | None) -> int:
    level = 0
    for lv in cfg["readiness"]["levels"]:
        ok = ((sot_pct is None or sot_pct >= lv["sot_pct_min"]) and (tandem is None or tandem >= lv["tandem_min"])
              and (dizzy is None or dizzy <= lv["dizzy_max"]))
        if ok:
            level = max(level, lv["level"])
    return level


def level_info(cfg: dict, level: int) -> dict[str, Any]:
    r = cfg["readiness"]
    lv = next(x for x in r["levels"] if x["level"] == level)
    return {"level": level, "label": lv["label"], "label_tr": lv.get("label_tr"), "max_level": max(x["level"] for x in r["levels"]),
            "activities": [{"id": a["id"], "label": a["label"], "label_tr": a.get("label_tr"), "min_level": a["min_level"],
                            "allowed": level >= a["min_level"]} for a in r["activities"]],
            "levels": [{"level": x["level"], "label": x["label"], "label_tr": x.get("label_tr"),
                        "sot_pct_min": x["sot_pct_min"], "tandem_min": x["tandem_min"], "dizzy_max": x["dizzy_max"]}
                       for x in r["levels"]],
            "source": r["source"], "verified": r["verified"]}


def balance_recovery(days: list[int], values: list[float], landing: int, baseline: float | None,
                     alpha: float = 0.7) -> dict[str, Any] | None:
    """Progress back to the preflight balance score after landing, with days to 90 %."""
    if baseline is None:
        return None
    raw = [(d, v) for d, v in zip(days, values) if d >= landing]
    if not raw:
        return None
    post = list(zip([d for d, _ in raw], ewma([v for _, v in raw], alpha)))
    start = raw[0][1]
    prog = [progress(v, start, baseline, direction="up", stop_at_target=True) for _, v in post]
    t_rel = [d - landing + 1 for d, _ in post]
    dtt = days_to_target(t_rel, prog, 0.9)
    return {"start": start, "baseline": baseline, "current": post[-1][1], "progress": prog[-1],
            "history": [{"day": d, "progress": p} for (d, _), p in zip(post, prog)],
            "days_to_90": dtt, "days_since_landing": post[-1][0] - landing}
