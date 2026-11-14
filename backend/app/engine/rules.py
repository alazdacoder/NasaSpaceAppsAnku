"""Transparent rules engine driven entirely by config/reference.yaml.

Per metric: EWMA-smoothed value, z-score against the personal preflight baseline,
7-day slope, anomaly flag, then each configured rule -> green / amber / red plus a
recommendation from the fixed list, always with the reason that triggered it.
"""
from __future__ import annotations

import operator
import re
from typing import Any

from .stats import ewma, mean_sd, pct_change, slope, zscore

LEVELS = {"green": 0, "amber": 1, "red": 2}
OPS = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge}


def worst(levels) -> str:
    best = "green"
    for lv in levels:
        if LEVELS.get(lv, 0) > LEVELS[best]:
            best = lv
    return best


def fmt(value: float | None, decimals: int) -> str:
    if value is None:
        return "-"
    return f"{value:.{decimals}f}"


def evaluate_metric(mid: str, mdef: dict, days: list[int], values: list[float], defaults: dict,
                    today: int) -> dict[str, Any] | None:
    if not values:
        return None
    alpha = mdef.get("ewma_alpha", defaults["ewma_alpha"])
    dec = mdef.get("decimals", 1)
    unit = mdef.get("unit", "")
    sm = ewma(values, alpha)

    base_vals = [v for d, v in zip(days, values) if d < 0]
    has_baseline = mdef.get("baseline") != "none" and len(base_vals) >= 3
    if has_baseline:
        b_mean, b_sd = mean_sd(base_vals, mdef.get("min_sd", 0.0))
    else:
        b_mean, b_sd = None, None

    # 7-day slope of the smoothed series (units per day)
    n = defaults.get("slope_days", 7)
    recent = [(d, v) for d, v in zip(days, sm) if d > today - n]
    sl = slope([d for d, _ in recent], [v for _, v in recent]) if len(recent) >= 3 else 0.0

    latest, latest_s = values[-1], sm[-1]
    z = zscore(latest_s, b_mean, b_sd) if has_baseline else None
    pct = pct_change(latest_s, b_mean) if has_baseline else None
    anomaly = False
    if len(sm) >= 2:
        ref_sd = b_sd if has_baseline else mdef.get("min_sd", 0) or None
        if ref_sd:
            anomaly = abs(latest - sm[-2]) / ref_sd > defaults.get("anomaly_z", 3.0)

    label = mdef["label"]
    u = f" {unit}" if unit else ""
    triggered = []
    for rule in mdef.get("rules", []):
        t, thr = rule["type"], rule["value"]
        hit, reason = False, ""
        if t == "below":
            hit = latest_s < thr
            reason = f"{label} {fmt(latest_s, dec)}{u} is below {thr}{u}."
        elif t == "above":
            hit = latest_s > thr
            reason = f"{label} {fmt(latest_s, dec)}{u} is above {thr}{u}."
        elif t in ("z_above", "z_below") and z is not None:
            hit = z > thr if t == "z_above" else z < -abs(thr)
            reason = f"{label} is {z:+.1f} SD from your baseline of {fmt(b_mean, dec)}{u}."
        elif t in ("pct_above", "pct_below") and pct is not None:
            hit = pct > thr if t == "pct_above" else pct < -abs(thr)
            reason = f"{label} is {pct:+.0f}% vs your baseline of {fmt(b_mean, dec)}{u} (limit {'+' if t == 'pct_above' else '-'}{abs(thr)}%)."
        elif t in ("slope_above", "slope_below"):
            hit = sl > thr if t == "slope_above" else sl < thr
            reason = f"{label} is changing {sl:+.{max(dec, 1)}f}{u} per day over {n} days."
        if hit:
            triggered.append({"level": rule["level"], "rec": rule.get("rec"), "reason": reason,
                              "rule": f"{t} {thr}", "source": rule["source"], "verified": rule["verified"]})

    status = worst(r["level"] for r in triggered)
    return {
        "metric": mid, "label": label, "unit": unit, "decimals": dec, "group": mdef.get("group"),
        "device": mdef.get("device"), "meaning": mdef.get("meaning", ""),
        "value": latest, "ewma": latest_s, "day": days[-1],
        "baseline_mean": b_mean, "baseline_sd": b_sd, "z": z, "pct": pct, "slope": sl,
        "anomaly": anomaly, "status": status, "triggered": triggered,
        "stale": days[-1] < today - 2,
    }


_PLACEHOLDER = re.compile(r"\{([a-z0-9_]+)\.([a-z]+)\}")


def _field(ev: dict, field: str) -> float | None:
    return {"value": ev["value"], "ewma": ev["ewma"], "z": ev["z"], "slope": ev["slope"], "pct": ev["pct"]}.get(field)


def evaluate_cross_rule(rule: dict, evals: dict[str, dict]) -> dict | None:
    for cond in rule["when"]:
        ev = evals.get(cond["metric"])
        if ev is None or ev.get("stale"):
            return None
        val = _field(ev, cond["field"])
        if val is None or not OPS[cond["op"]](val, cond["value"]):
            return None

    def repl(m: re.Match) -> str:
        ev = evals[m.group(1)]
        val = _field(ev, m.group(2))
        dec = 1 if m.group(2) in ("z", "slope") else ev["decimals"]
        return fmt(val, dec)

    return {"id": rule["id"], "title": rule["title"], "level": rule["level"],
            "reason": _PLACEHOLDER.sub(repl, rule["reason"]), "recs": rule["recs"],
            "metrics": [c["metric"] for c in rule["when"]],
            "source": rule["source"], "verified": rule["verified"]}


def build_rec(cfg: dict, rec_id: str) -> dict:
    r = cfg["recommendations"][rec_id]
    return {"id": rec_id, "text": r["text"], "source": r["source"], "verified": r["verified"]}


def evaluate_crew(cfg: dict, series: dict[str, tuple[list[int], list[float]]], today: int,
                  protocol_results: list[dict] | None = None) -> dict[str, Any]:
    """Evaluate all metrics + cross-source rules + protocol rules for one crew member."""
    defaults = cfg["defaults"]
    evals: dict[str, dict] = {}
    for mid, mdef in cfg["metrics"].items():
        days, vals = series.get(mid, ([], []))
        ev = evaluate_metric(mid, mdef, days, vals, defaults, today)
        if ev:
            evals[mid] = ev

    alerts: list[dict] = []
    for mid, ev in evals.items():
        if ev["status"] == "green" or ev["stale"]:
            continue
        top = [t for t in ev["triggered"] if t["level"] == ev["status"]]
        reason = " ".join(dict.fromkeys(t["reason"] for t in top))
        recs = list(dict.fromkeys(t["rec"] for t in top if t.get("rec")))
        alerts.append({"id": f"metric:{mid}", "kind": "metric", "title": ev["label"], "level": ev["status"],
                       "reason": reason, "recs": [build_rec(cfg, r) for r in recs], "metrics": [mid],
                       "source": top[0]["source"], "verified": all(t["verified"] for t in top)})

    for rule in cfg["cross_rules"]:
        hit = evaluate_cross_rule(rule, evals)
        if hit:
            hit["kind"] = "cross"
            hit["recs"] = [build_rec(cfg, r) for r in hit["recs"]]
            alerts.append(hit)

    pr = cfg["protocol_rules"]
    for res in protocol_results or []:
        if res.get("score") is None or res.get("days_since_start", 0) < pr["min_days"]:
            continue
        if res["score"] < pr["poor_response_below"]:
            alerts.append({"id": f"protocol:{res['protocol_id']}", "kind": "protocol", "level": pr["level"],
                           "title": f"{res['label']} is not working well",
                           "reason": (f"Response score {res['score']:.2f} after {res['days_since_start']} days "
                                      f"is below {pr['poor_response_below']}."),
                           "recs": [build_rec(cfg, r) for r in pr["recs"]], "metrics": [t["metric"] for t in res["targets"]],
                           "source": pr["source"], "verified": pr["verified"]})

    alerts.sort(key=lambda a: (-LEVELS[a["level"]], 0 if a["kind"] == "cross" else 1))
    overall = worst(a["level"] for a in alerts)
    return {"today": today, "overall": overall, "metrics": evals, "alerts": alerts}
