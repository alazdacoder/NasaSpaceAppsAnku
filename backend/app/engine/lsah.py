"""LSAH (Lifetime Surveillance of Astronaut Health) helpers.

- The annual medical examination plan from MR089S: which exams are due at a crew
  member's next birth month, from their age, sex and last DXA year.
- The mission test calendar: which LSAH-category tests this app runs on which day.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any


def launch_date(cfg: dict) -> date:
    return date.fromisoformat(cfg["simulation"]["launch_date"])


def mission_date(cfg: dict, day: int) -> date:
    return launch_date(cfg) + timedelta(days=day)


def _ym(s: str) -> tuple[int, int]:
    y, m = s.split("-")
    return int(y), int(m)


def age_on(birth: str, d: date) -> int:
    by, bm = _ym(birth)
    return d.year - by - (1 if d.month < bm else 0)


def annual_plan(cfg: dict, prof: dict, ref: date) -> dict[str, Any]:
    """The next annual exam (birth month on or after `ref`) and the MR089S items due then."""
    by, bm = _ym(prof["birth"])
    due = date(ref.year, bm, 1)
    if (due.year, due.month) < (ref.year, ref.month):
        due = date(ref.year + 1, bm, 1)
    age = due.year - by                       # completed years during the birth month
    items = []
    for it in cfg["lsah"]["annual_exam"]["items"]:
        if it.get("sex") and it["sex"] != prof["sex"]:
            continue
        if it.get("min_age") and age < it["min_age"]:
            continue
        rule = it["rule"]
        if rule == "yearly":
            ok = True
        elif rule == "gxt_age":
            ok = age in (30, 35, 40) or (40 < age <= 50 and (age - 40) % 2 == 0) or age > 50
        elif rule == "mammo_age":
            ok = (40 <= age <= 50 and (age - 40) % 2 == 0) or age > 50
        elif rule == "every_3_years":
            ok = due.year - int(prof["last_dxa_year"]) >= 3
        elif rule == "at_ages":
            ok = age in it.get("ages", [])
        else:
            ok = False
        items.append({"id": it["id"], "label": it["label"], "label_tr": it.get("label_tr"), "rule": rule, "due": ok})
    landing = mission_date(cfg, int(cfg["simulation"]["mission_days"]))
    in_flight = launch_date(cfg) <= due <= landing
    return {"month": due.strftime("%Y-%m"), "age": age, "in_flight": in_flight, "items": items,
            "source": cfg["lsah"]["annual_exam"]["source"], "verified": cfg["lsah"]["annual_exam"]["verified"]}


def test_days(cfg: dict, test: dict) -> list[int]:
    landing = int(cfg["simulation"]["mission_days"])
    return sorted(set(test.get("days", [])) | {landing + r for r in test.get("r_days", [])})


def tests_on(cfg: dict, day: int) -> list[dict]:
    return [t for t in cfg["lsah"]["mission_tests"]["tests"] if day in test_days(cfg, t)]
