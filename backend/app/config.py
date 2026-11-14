"""Loads config/reference.yaml - the single source for values, thresholds and rules."""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

FROZEN = bool(getattr(sys, "frozen", False))   # running as a PyInstaller executable


def _resource_root() -> Path:
    """Folder holding config/ and frontend/dist (the unpacked bundle when frozen)."""
    if os.environ.get("HUB_ROOT"):            # set by the Android app (android/app/src/main/python/android_main.py)
        return Path(os.environ["HUB_ROOT"])
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[2]


def _data_dir() -> Path:
    """Writable folder for the database and the OSDR cache."""
    if os.environ.get("HUB_DATA_DIR"):
        return Path(os.environ["HUB_DATA_DIR"])
    if FROZEN:
        base = os.environ.get("LOCALAPPDATA") or os.path.join(Path.home(), ".local", "share")
        return Path(base) / "CrewHealthHub"
    return _resource_root() / "data"


ROOT = _resource_root()
DATA_DIR = _data_dir()
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
    for key in ("simulation", "model", "prescription", "limits", "cevis_limits", "food_catalog", "energy",
                "schedule", "mind", "vestibular", "readiness"):
        need(cfg[key], key)
    for nid, n in cfg["nutrition_targets"].items():
        need(n, f"nutrition_targets.{nid}")
    if problems:
        raise ValueError("Invalid reference config:\n  " + "\n  ".join(problems))


def metric_defs() -> dict[str, dict[str, Any]]:
    return load_config()["metrics"]


def crew_defs() -> list[dict[str, Any]]:
    return load_config()["crew"]


def phase_of(cfg: dict[str, Any], day: int) -> str:
    """preflight (day < 0) | inflight (0 .. mission_days-1) | postflight (landing day onward)."""
    if day < 0:
        return "preflight"
    return "inflight" if day < int(cfg["simulation"]["mission_days"]) else "postflight"


def rule_text_tr(t: str, value: Any) -> str:
    """Turkish word order for a rule, e.g. 'below 80' -> '80 altında', 'pct_above 50' -> '%50 üstünde'."""
    word = "altında" if t.endswith("below") else "üstünde"
    if t.startswith("pct"):
        return f"%{abs(value)} {word}"
    if t.startswith("z"):
        return f"z {value} {word}"
    if t.startswith("slope"):
        return f"eğim {value} {word}"
    return f"{value} {word}"


LEVEL_TR = {"green": "yeşil", "amber": "sarı", "red": "kırmızı"}


def unverified_items(cfg: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """Flat list of every value marked verified: false (for README and the Sources page)."""
    cfg = cfg or load_config()
    out: list[dict[str, str]] = []

    def add(kind: str, ident: str, desc: str, source: str, desc_tr: str | None = None) -> None:
        out.append({"kind": kind, "id": ident, "description": desc, "description_tr": desc_tr or desc, "source": source})

    for key, label, label_tr in (
            ("simulation", "Simulation settings", "Simülasyon ayarları"),
            ("model", "Physiology model coefficients", "Fizyoloji modeli katsayıları"),
            ("prescription", "Daily ARED / cardio split of the exercise prescription", "Egzersiz reçetesinin günlük ARED / kardiyo dağılımı"),
            ("cevis_limits", "CEVIS maximum power", "CEVIS en yüksek gücü"),
            ("food_catalog", "Food catalogue nutrient values", "Yemek kataloğu besin değerleri"),
            ("energy", "Energy cost of each activity (MET values, ACSM equations)", "Her etkinliğin enerji maliyeti (MET değerleri, ACSM denklemleri)"),
            ("schedule", "Crew day schedule (activity times)", "Mürettebat günlük programı (etkinlik saatleri)"),
            ("mind", "Behavioural health model (stress, tiredness, reaction time)", "Davranışsal sağlık modeli (stres, yorgunluk, tepki süresi)"),
            ("vestibular", "Post-flight vestibular model (balance drop and recovery)", "Uçuş sonrası vestibüler model (denge kaybı ve toparlanma)"),
            ("readiness", "Return-to-Earth readiness levels and allowed activities", "Dünya'ya uyum seviyeleri ve izin verilen etkinlikler")):
        if not cfg[key]["verified"]:
            add("model", key, label, cfg[key]["source"], label_tr)
    for mid, m in cfg["metrics"].items():
        for r in m.get("rules", []):
            if not r["verified"]:
                add("threshold", mid, f"{m['label']}: {r['type']} {r['value']} -> {r['level']}", r["source"],
                    f"{m.get('label_tr', m['label'])}: {rule_text_tr(r['type'], r['value'])} -> "
                    f"{LEVEL_TR.get(r['level'], r['level'])}")
        if m.get("estimate_verified") is False:
            add("estimate", mid, f"{m['label']}: {m.get('estimate_note', '')}", cfg["sources"]["sim"],
                f"{m.get('label_tr', m['label'])}: {m.get('estimate_note_tr', m.get('estimate_note', ''))}")
    for r in cfg["cross_rules"]:
        if not r["verified"]:
            add("cross_rule", r["id"], r["title"], r["source"], r.get("title_tr"))
    if not cfg["protocol_rules"]["verified"]:
        pr = cfg["protocol_rules"]
        add("protocol_rule", "poor_response", f"Response score below {pr['poor_response_below']} after {pr['min_days']} days",
            pr["source"], f"{pr['min_days']} gün sonra yanıt puanı {pr['poor_response_below']} altında")
    for rid, r in cfg["recommendations"].items():
        if not r["verified"]:
            add("recommendation", rid, r["text"], r["source"], r.get("text_tr"))
    for nid, n in cfg["nutrition_targets"].items():
        if not n["verified"]:
            add("nutrition_target", nid, f"{nid} target {n['value']}", n["source"], f"{nid} hedefi {n['value']}")
    for pid, p in cfg["link"]["profiles"].items():
        if not p["verified"]:
            b = p["blackout"]
            add("link", pid, f"{p['label']}: delay {p['delay_s']} s, blackout {b['duration_s']} s every {b['period_s']} s",
                p["source"], f"{p.get('label_tr', p['label'])}: gecikme {p['delay_s']} sn, her {b['period_s']} sn'de "
                f"{b['duration_s']} sn kesinti")
    return out
