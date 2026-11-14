"""Manual entries (food, water, supplements, how I feel) and CSV import, behind the
same adapter interface as the devices."""
from __future__ import annotations

import csv
import io
from typing import Any

from .base import DeviceAdapter, DeviceStatus


class ManualAdapter(DeviceAdapter):
    id, name, kind = "manual", "Manual entries", "manual"
    description = "Food, water, supplements taken and how I feel (1-5), entered on the tablet. Galley meals are auto-logged."
    metrics = ("kcal", "water_l", "protein_g", "sodium_mg", "calcium_mg", "vitd_iu", "feeling")
    simulated = True
    has_battery = False

    def read_day(self, crew_id: str, day: int, world: Any) -> dict[str, float]:
        truth = world.day_truth(crew_id, day)
        if truth is None:
            return {}
        self.last_sync[crew_id] = day + 1.0
        out = dict(truth["food"])
        out["water_l"] = truth["water_l"]
        out["feeling"] = truth["feeling"]
        return out

    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        return DeviceStatus(self.id, True, None, self.last_sync.get(crew_id), "connected", "Tablet input")


class CSVImportAdapter(DeviceAdapter):
    """Imports rows `crew_id,day,metric,value` - e.g. data exported from a real device."""
    id, name, kind = "csv", "CSV import", "manual"
    description = "Upload a CSV with columns crew_id, day, metric, value."
    metrics = ()
    simulated = False
    has_battery = False

    def __init__(self) -> None:
        super().__init__()
        self.imported_rows = 0

    def read_day(self, crew_id: str, day: int, world: Any) -> dict[str, float]:
        return {}

    def parse(self, text: str, known_metrics: set[str], known_crew: set[str]) -> tuple[list[tuple], list[str]]:
        rows, errors = [], []
        reader = csv.DictReader(io.StringIO(text))
        need = {"crew_id", "day", "metric", "value"}
        if not reader.fieldnames or not need.issubset({f.strip() for f in reader.fieldnames}):
            return [], [f"CSV header must contain: {', '.join(sorted(need))}"]
        for i, row in enumerate(reader, start=2):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            try:
                crew, day, metric, value = row["crew_id"], int(row["day"]), row["metric"], float(row["value"])
            except (KeyError, ValueError):
                errors.append(f"line {i}: could not parse")
                continue
            if crew not in known_crew:
                errors.append(f"line {i}: unknown crew '{crew}'")
            elif metric not in known_metrics:
                errors.append(f"line {i}: unknown metric '{metric}'")
            else:
                rows.append((crew, day, metric, value))
        return rows, errors

    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        return DeviceStatus(self.id, True, None, self.last_sync.get(crew_id), "connected",
                            f"{self.imported_rows} rows imported")
