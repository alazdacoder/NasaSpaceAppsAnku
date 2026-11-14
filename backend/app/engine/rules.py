"""Transparent rules engine driven entirely by config/reference.yaml.

Per metric: EWMA-smoothed value, z-score against the personal preflight baseline,
7-day slope, anomaly flag, then each configured rule -> green / amber / red plus a
recommendation from the fixed list, always with the reason that triggered it.
"""
from __future__ import annotations

import operator
import re
from typing import Any

from .stats import ewma_days, mean_sd, pct_change, slope, zscore

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


def _reasons(t: str, label: str, label_tr: str, v: str, thr: Any, u: str, u_tr: str, *, z: float | None = None,
             base: str = "", pct: float | None = None, sl: float | None = None, dec: int = 1, n: int = 7) -> tuple[str, str]:
    """English and Turkish reason text for one triggered metric rule."""
    if t == "below":
        return f"{label} {v}{u} is below {thr}{u}.", f"{label_tr} {v}{u_tr}; {thr}{u_tr} sınırının altında."
    if t == "above":
        return f"{label} {v}{u} is above {thr}{u}.", f"{label_tr} {v}{u_tr}; {thr}{u_tr} sınırının üstünde."
    if t in ("z_above", "z_below"):
        return (f"{label} is {z:+.1f} SD from your baseline of {base}{u}.",
                f"{label_tr}, {base}{u_tr} olan kişisel referansından {z:+.1f} SS uzakta.")
    if t in ("pct_above", "pct_below"):
        sign = "+" if t == "pct_above" else "-"
        word = "daha yüksek" if (pct or 0) >= 0 else "daha düşük"
        return (f"{label} is {pct:+.0f}% vs your baseline of {base}{u} (limit {sign}{abs(thr)}%).",
                f"{label_tr}, {base}{u_tr} olan kişisel referansından %{abs(pct or 0):.0f} {word} (sınır {sign}%{abs(thr)}).")
    return (f"{label} is changing {sl:+.{max(dec, 1)}f}{u} per day over {n} days.",
            f"{label_tr} son {n} günde günde {sl:+.{max(dec, 1)}f}{u_tr} değişiyor.")


def evaluate_metric(mid: str, mdef: dict, days: list[int], values: list[float], defaults: dict,
                    today: int, phase: str | None = None) -> dict[str, Any] | None:
    if not values:
        return None
    alpha = mdef.get("ewma_alpha", defaults["ewma_alpha"])
    dec = mdef.get("decimals", 1)
    unit = mdef.get("unit", "")
    sm = ewma_days(days, values, alpha)

    base_vals = [v for d, v in zip(days, values) if d < 0]
    has_baseline = mdef.get("baseline") != "none" and len(base_vals) >= mdef.get("baseline_min_n", 3)
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
    label_tr = mdef.get("label_tr", label)
    u = f" {unit}" if unit else ""
    unit_tr = mdef.get("unit_tr", unit)
    u_tr = f" {unit_tr}" if unit_tr else ""
    triggered = []
    for rule in mdef.get("rules", []):
        if phase and rule.get("phases") and phase not in rule["phases"]:
            continue
        t, thr = rule["type"], rule["value"]
        hit = False
        if t == "below":
            hit = latest_s < thr
        elif t == "above":
            hit = latest_s > thr
        elif t in ("z_above", "z_below"):
            if z is None:
                continue
            hit = z > thr if t == "z_above" else z < -abs(thr)
        elif t in ("pct_above", "pct_below"):
            if pct is None:
                continue
            hit = pct > thr if t == "pct_above" else pct < -abs(thr)
        elif t in ("slope_above", "slope_below"):
            hit = sl > thr if t == "slope_above" else sl < thr
        if hit:
            reason, reason_tr = _reasons(t, label, label_tr, fmt(latest_s, dec), thr, u, u_tr, z=z,
                                         base=fmt(b_mean, dec), pct=pct, sl=sl, dec=dec, n=n)
            triggered.append({"level": rule["level"], "rec": rule.get("rec"), "reason": reason, "reason_tr": reason_tr,
                              "rule": f"{t} {thr}", "source": rule["source"], "verified": rule["verified"]})

    status = worst(r["level"] for r in triggered)
    return {
        "metric": mid, "label": label, "label_tr": label_tr, "unit": unit, "unit_tr": unit_tr, "decimals": dec,
        "group": mdef.get("group"), "device": mdef.get("device"), "meaning": mdef.get("meaning", ""),
        "meaning_tr": mdef.get("meaning_tr"),
        "value": latest, "ewma": latest_s, "day": days[-1],
        "baseline_mean": b_mean, "baseline_sd": b_sd, "z": z, "pct": pct, "slope": sl,
        "anomaly": anomaly, "status": status, "triggered": triggered,
        "stale": days[-1] < today - mdef.get("stale_days", 2),
    }


_PLACEHOLDER = re.compile(r"\{([a-z0-9_]+)\.([a-z]+)\}")


def _field(ev: dict, field: str) -> float | None:
    pct = ev["pct"]
    return {"value": ev["value"], "ewma": ev["ewma"], "z": ev["z"], "slope": ev["slope"], "pct": pct,
            "pct_abs": None if pct is None else abs(pct)}.get(field)


def evaluate_cross_rule(rule: dict, evals: dict[str, dict], phase: str | None = None) -> dict | None:
    if phase and rule.get("phases") and phase not in rule["phases"]:
        return None
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
        dec = 1 if m.group(2) in ("z", "slope") else 0 if m.group(2) in ("pct", "pct_abs") else ev["decimals"]
        if m.group(2) == "slope" and abs(val or 0) < 0.1:
            dec = 2
        return fmt(val, dec)

    return {"id": rule["id"], "title": rule["title"], "title_tr": rule.get("title_tr"), "level": rule["level"],
            "reason": _PLACEHOLDER.sub(repl, rule["reason"]),
            "reason_tr": _PLACEHOLDER.sub(repl, rule.get("reason_tr", rule["reason"])), "recs": rule["recs"],
            "metrics": [c["metric"] for c in rule["when"]],
            "source": rule["source"], "verified": rule["verified"]}


def build_rec(cfg: dict, rec_id: str) -> dict:
    r = cfg["recommendations"][rec_id]
    return {"id": rec_id, "text": r["text"], "text_tr": r.get("text_tr"), "source": r["source"], "verified": r["verified"]}


def evaluate_crew(cfg: dict, series: dict[str, tuple[list[int], list[float]]], today: int,
                  protocol_results: list[dict] | None = None, phase: str | None = None) -> dict[str, Any]:
    """Evaluate all metrics + cross-source rules + protocol rules for one crew member."""
    defaults = cfg["defaults"]
    evals: dict[str, dict] = {}
    for mid, mdef in cfg["metrics"].items():
        days, vals = series.get(mid, ([], []))
        ev = evaluate_metric(mid, mdef, days, vals, defaults, today, phase)
        if ev:
            evals[mid] = ev

    alerts: list[dict] = []
    for mid, ev in evals.items():
        if ev["status"] == "green" or ev["stale"]:
            continue
        top = [t for t in ev["triggered"] if t["level"] == ev["status"]]
        reason = " ".join(dict.fromkeys(t["reason"] for t in top))
        reason_tr = " ".join(dict.fromkeys(t["reason_tr"] for t in top))
        recs = list(dict.fromkeys(t["rec"] for t in top if t.get("rec")))
        alerts.append({"id": f"metric:{mid}", "kind": "metric", "title": ev["label"], "title_tr": ev["label_tr"],
                       "level": ev["status"], "reason": reason, "reason_tr": reason_tr,
                       "recs": [build_rec(cfg, r) for r in recs], "metrics": [mid],
                       "source": top[0]["source"], "verified": all(t["verified"] for t in top)})

    for rule in cfg["cross_rules"]:
        hit = evaluate_cross_rule(rule, evals, phase)
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
                           "title_tr": f"{res.get('label_tr') or res['label']} yeterince etkili değil",
                           "reason": (f"Response score {res['score']:.2f} after {res['days_since_start']} days "
                                      f"is below {pr['poor_response_below']}."),
                           "reason_tr": (f"{res['days_since_start']} gün sonra yanıt puanı {res['score']:.2f}; "
                                         f"{pr['poor_response_below']} sınırının altında."),
                           "recs": [build_rec(cfg, r) for r in pr["recs"]], "metrics": [t["metric"] for t in res["targets"]],
                           "source": pr["source"], "verified": pr["verified"]})

    alerts.sort(key=lambda a: (-LEVELS[a["level"]], 0 if a["kind"] == "cross" else 1))
    overall = worst(a["level"] for a in alerts)
    return {"today": today, "overall": overall, "metrics": evals, "alerts": alerts}
