"""One interface for every data source, so a real device can replace a simulated one.

A real adapter would implement the same three methods by talking to hardware or a
file; the rest of the app (storage, rules, UI) does not change.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class DeviceStatus:
    device_id: str
    connected: bool
    battery_pct: float | None
    last_sync_mission_t: float | None
    state: str = "connected"          # connected | syncing | offline | disabled
    note: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


class DeviceAdapter(ABC):
    id: str = ""
    name: str = ""
    kind: str = ""                     # exercise | wearable | environment | lab | manual
    description: str = ""
    metrics: tuple[str, ...] = ()
    simulated: bool = True
    has_battery: bool = True

    def __init__(self) -> None:
        self.enabled = True
        self.last_sync: dict[str, float] = {}   # crew_id -> mission time of last successful read

    @abstractmethod
    def read_day(self, crew_id: str, day: int, world: Any) -> dict[str, float]:
        """Return daily values {metric: value} for one crew member and mission day."""

    def live(self, crew_id: str, mission_t: float, world: Any) -> dict[str, float]:
        """Current reading (optional)."""
        return {}

    @abstractmethod
    def status(self, crew_id: str, mission_t: float, real_t: float) -> DeviceStatus:
        """Connection status, battery and last sync."""

    def info(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "kind": self.kind, "description": self.description,
                "metrics": list(self.metrics), "simulated": self.simulated, "enabled": self.enabled}
