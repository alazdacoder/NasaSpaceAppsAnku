"""Holds the running World and drives it from a background loop."""
from __future__ import annotations

import asyncio
import logging
import os

from .config import ROOT, load_config
from .db import DB
from .sim.world import World

log = logging.getLogger("hub")


class AppState:
    def __init__(self, db_path: str | None = None, seed: int | None = None, start_day: int | None = None):
        self.cfg = load_config()
        self.db_path = db_path or os.environ.get("HUB_DB", str(ROOT / "data" / "hub.db"))
        self.start_day = start_day
        self.world = self._make(seed)
        self._task: asyncio.Task | None = None

    def _make(self, seed: int | None) -> World:
        env_seed = os.environ.get("HUB_SEED")
        seed = seed if seed is not None else (int(env_seed) if env_seed else None)
        db = DB(self.db_path, fresh=True)
        w = World(self.cfg, db, seed=seed)
        w.bootstrap(self.start_day)
        log.info("World ready: seed=%s day=%s", w.seed, w.today)
        return w

    def reset(self, seed: int | None = None) -> None:
        old = self.world
        old.db.conn.close()
        self.world = self._make(seed)

    async def run(self, period: float = 0.25) -> None:
        while True:
            try:
                self.world.tick()
            except Exception:  # keep the demo alive; log and continue
                log.exception("tick failed")
            await asyncio.sleep(period)

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
