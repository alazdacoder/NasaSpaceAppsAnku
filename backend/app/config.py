"""Loads config/reference.yaml - the single source for values, thresholds and rules."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get("HUB_CONFIG", ROOT / "config" / "reference.yaml"))


@lru_cache(maxsize=1)
def load_config(path: str | None = None) -> dict[str, Any]:
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    _validate(cfg)
    return cfg


def _validate(cfg: dict[str, Any]) -> None:
    """Every reference, rule, recommendation and protocol target needs source + verified."""
    problems: list[str] = []

    def need(obj: dict, where: str) -> None:
        for key in ("source", "verified"):
            if key not in obj:
                problems.append(f"{where}: missing '{key}'")

    for ref in cfg["references"]:
        need(ref, f"references.{ref.get('id')}")
        if ref.get("verified") is not True:
            problems.append(f"references.{ref.get('id')}: reference values must be verified")
    for mid, m in cfg["metrics"].items():
        for i, r in enumerate(m.get("rules", [])):
            need(r, f"metrics.{mid}.rules[{i}]")
    for r in cfg["cross_rules"]:
        need(r, f"cross_rules.{r['id']}")
    for rid, r in cfg["recommendations"].items():
        need(r, f"recommendations.{rid}")
    for pid, p in cfg["protocols"].items():
        need(p, f"protocols.{pid}")
        for t in p["targets"]:
            need(t, f"protocols.{pid}.targets.{t['metric']}")
    for pid, p in cfg["link"]["profiles"].items():
        need(p, f"link.profiles.{pid}")
    for key in ("simulation", "model", "prescription", "limits", "cevis_limits", "food_catalog"):
        need(cfg[key], key)
    for nid, n in cfg["nutrition_targets"].items():
        need(n, f"nutrition_targets.{nid}")
    if problems:
        raise ValueError("Invalid reference config:\n  " + "\n  ".join(problems))


def metric_defs() -> dict[str, dict[str, Any]]:
    return load_config()["metrics"]


def crew_defs() -> list[dict[str, Any]]:
    return load_config()["crew"]


def unverified_items(cfg: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """Flat list of every value marked verified: false (for README and the Sources page)."""
    cfg = cfg or load_config()
    out: list[dict[str, str]] = []

    def add(kind: str, ident: str, desc: str, source: str) -> None:
        out.append({"kind": kind, "id": ident, "description": desc, "source": source})

    for key, label in (("simulation", "Simulation settings"), ("model", "Physiology model coefficients"),
                       ("prescription", "Daily ARED / cardio split of the exercise prescription"),
                       ("cevis_limits", "CEVIS maximum power"),
                       ("food_catalog", "Food catalogue nutrient values")):
        if not cfg[key]["verified"]:
            add("model", key, label, cfg[key]["source"])
    for mid, m in cfg["metrics"].items():
        for r in m.get("rules", []):
            if not r["verified"]:
                add("threshold", mid, f"{m['label']}: {r['type']} {r['value']} -> {r['level']}", r["source"])
        if m.get("estimate_verified") is False:
            add("estimate", mid, f"{m['label']}: {m.get('estimate_note', '')}", cfg["sources"]["sim"])
    for r in cfg["cross_rules"]:
        if not r["verified"]:
            add("cross_rule", r["id"], r["title"], r["source"])
    if not cfg["protocol_rules"]["verified"]:
        pr = cfg["protocol_rules"]
        add("protocol_rule", "poor_response", f"Response score below {pr['poor_response_below']} after {pr['min_days']} days", pr["source"])
    for rid, r in cfg["recommendations"].items():
        if not r["verified"]:
            add("recommendation", rid, r["text"], r["source"])
    for nid, n in cfg["nutrition_targets"].items():
        if not n["verified"]:
            add("nutrition_target", nid, f"{nid} target {n['value']}", n["source"])
    for pid, p in cfg["link"]["profiles"].items():
        if not p["verified"]:
            add("link", pid, f"{p['label']}: delay {p['delay_s']} s, blackout {p['blackout']['duration_s']} s every {p['blackout']['period_s']} s", p["source"])
    return out
