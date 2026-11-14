"""Store-and-forward ground link.

Onboard, every update becomes a numbered packet in the outbox. The link sends queued
packets whenever it is up (no blackout), each packet arrives after the profile's one-way
light delay, and the ground acknowledges it one more delay later. The crew app never
waits for any of this: it reads the onboard database only. The flight-surgeon view
reads only the ground tables, which change when a packet arrives - so with the Mars
profile the surgeon sees the mission as it was up to 22 minutes ago.

Delays run in REAL seconds (not on the fast mission clock) so the lag is visible.
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable

from ..db import DB, dumps


class GroundLink:
    def __init__(self, db: DB, cfg: dict, clock: Callable[[], float] = time.time):
        self.db = db
        self.cfg = cfg["link"]
        self.clock = clock
        self.profile = self.cfg["default_profile"]
        self.delay_override: dict[str, float] = {}
        self.forced_blackout = False
        self.epoch = clock()
        self.next_seq = 1
        self.on_profile_change: list[Callable[[str], None]] = []

    # -- configuration ------------------------------------------------------
    def profiles(self) -> dict[str, Any]:
        return self.cfg["profiles"]

    def delay_s(self, profile: str | None = None) -> float:
        p = profile or self.profile
        return float(self.delay_override.get(p, self.cfg["profiles"][p]["delay_s"]))

    def set_profile(self, profile: str, delay_s: float | None = None) -> None:
        if profile not in self.cfg["profiles"]:
            raise ValueError(f"unknown profile {profile}")
        pdef = self.cfg["profiles"][profile]
        if delay_s is not None:
            lo = pdef.get("delay_min_s", pdef["delay_s"])
            hi = pdef.get("delay_max_s", pdef["delay_s"])
            self.delay_override[profile] = max(lo, min(hi, float(delay_s)))
        changed = profile != self.profile
        self.profile = profile
        self.epoch = self.clock()     # blackout schedule restarts so the new link starts "up"
        if changed:
            for cb in self.on_profile_change:
                cb(profile)

    def in_blackout(self, now: float | None = None) -> bool:
        if self.forced_blackout:
            return True
        now = self.clock() if now is None else now
        b = self.cfg["profiles"][self.profile]["blackout"]
        phase = (now - self.epoch) % b["period_s"]
        return phase >= b["period_s"] - b["duration_s"]

    def next_window_change(self, now: float | None = None) -> float:
        """Seconds until the link goes down (if up) or comes back (if in blackout)."""
        now = self.clock() if now is None else now
        if self.forced_blackout:
            return float("inf")
        b = self.cfg["profiles"][self.profile]["blackout"]
        phase = (now - self.epoch) % b["period_s"]
        up_len = b["period_s"] - b["duration_s"]
        return (up_len - phase) if phase < up_len else (b["period_s"] - phase)

    # -- outbox -------------------------------------------------------------
    def enqueue(self, crew_id: str | None, kind: str, payload: dict, mission_t: float) -> int:
        seq = self.next_seq
        self.next_seq += 1
        self.db.execute(
            "INSERT INTO outbox(seq, crew_id, kind, payload, mission_t, created_real, status) VALUES (?,?,?,?,?,?, 'queued')",
            (seq, crew_id, kind, dumps(payload), mission_t, self.clock()))
        return seq

    def deliver_all_now(self) -> int:
        """Used once at startup: history before the demo is already on the ground."""
        now = self.clock()
        rows = self.db.all("SELECT * FROM outbox WHERE status='queued' ORDER BY seq")
        for r in rows:
            self._apply(r, now)
        self.db.execute("UPDATE outbox SET status='acked', sent_real=?, deliver_real=?, ack_real=? WHERE status='queued'",
                        (now, now, now))
        return len(rows)

    def pump(self) -> dict[str, int]:
        """Advance the link: send what can be sent, deliver what has arrived."""
        now = self.clock()
        sent = delivered = acked = 0
        if not self.in_blackout(now):
            d = self.delay_s()
            cur = self.db.execute(
                "UPDATE outbox SET status='in_flight', sent_real=?, deliver_real=?+? WHERE status='queued'",
                (now, now, d))
            sent = cur.rowcount
        rows = self.db.all("SELECT * FROM outbox WHERE status='in_flight' AND deliver_real<=? ORDER BY seq", (now,))
        for r in rows:
            self._apply(r, now)
            # ack travels back with the same delay it took to arrive
            ack = r["deliver_real"] + (r["deliver_real"] - r["sent_real"])
            self.db.execute("UPDATE outbox SET status='delivered', ack_real=? WHERE seq=?", (ack, r["seq"]))
            delivered += 1
        cur = self.db.execute("UPDATE outbox SET status='acked' WHERE status='delivered' AND ack_real<=?", (now,))
        acked = cur.rowcount
        return {"sent": sent, "delivered": delivered, "acked": acked}

    # -- ground side ----------------------------------------------------------
    def _apply(self, r: dict, received: float) -> None:
        payload = json.loads(r["payload"])
        kind = r["kind"]
        if kind == "daily":
            self.db.put_samples(r["crew_id"], payload["day"], payload["samples"], "link", table="g_samples")
        elif kind == "state":
            prev = self.db.one("SELECT seq FROM g_state WHERE crew_id=?", (r["crew_id"],))
            if prev is None or prev["seq"] < r["seq"]:
                self.db.execute(
                    "INSERT OR REPLACE INTO g_state(crew_id, payload, mission_t, created_real, received_real, seq) VALUES (?,?,?,?,?,?)",
                    (r["crew_id"], r["payload"], r["mission_t"], r["created_real"], received, r["seq"]))
        elif kind == "event":
            self.db.execute(
                "INSERT INTO g_event_log(seq, crew_id, mission_t, created_real, received_real, kind, level, text, text_tr) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (r["seq"], r["crew_id"], r["mission_t"], r["created_real"], received, payload.get("kind"),
                 payload.get("level"), payload.get("text"), payload.get("text_tr")))

    # -- status -------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        now = self.clock()
        counts = {r["status"]: r["n"] for r in self.db.all("SELECT status, COUNT(*) n FROM outbox GROUP BY status")}
        last_rx = self.db.one(
            "SELECT seq, mission_t, created_real, deliver_real FROM outbox WHERE status IN ('delivered','acked') "
            "ORDER BY deliver_real DESC, seq DESC LIMIT 1")
        next_arrival = self.db.one("SELECT MIN(deliver_real) t FROM outbox WHERE status='in_flight'")
        newest_rx_data = self.db.one(
            "SELECT MAX(created_real) t FROM outbox WHERE status IN ('delivered','acked')")
        last_ack = self.db.one("SELECT MAX(seq) s FROM outbox WHERE status='acked'")
        pdef = self.cfg["profiles"][self.profile]
        blackout = self.in_blackout(now)
        return {
            "profile": self.profile, "profile_label": pdef["label"], "profile_label_tr": pdef.get("label_tr"),
            "delay_s": self.delay_s(),
            "delay_min_s": pdef.get("delay_min_s", pdef["delay_s"]), "delay_max_s": pdef.get("delay_max_s", pdef["delay_s"]),
            "blackout": blackout, "forced_blackout": self.forced_blackout,
            "window_change_in_s": self.next_window_change(now) if not self.forced_blackout else None,
            "queued": counts.get("queued", 0), "in_flight": counts.get("in_flight", 0),
            "delivered": counts.get("delivered", 0) + counts.get("acked", 0), "acked": counts.get("acked", 0),
            "next_seq": self.next_seq, "last_acked_seq": (last_ack or {}).get("s"),
            "last_received_seq": last_rx["seq"] if last_rx else None,
            "next_arrival_in_s": (next_arrival["t"] - now) if next_arrival and next_arrival["t"] else None,
            "ground_data_age_s": (now - newest_rx_data["t"]) if newest_rx_data and newest_rx_data["t"] else None,
            "source": pdef["source"], "verified": pdef["verified"],
        }

    def recent_packets(self, limit: int = 30) -> list[dict]:
        now = self.clock()
        rows = self.db.all("SELECT seq, crew_id, kind, mission_t, created_real, sent_real, deliver_real, ack_real, status "
                           "FROM outbox ORDER BY seq DESC LIMIT ?", (limit,))
        for r in rows:
            r["age_s"] = now - r["created_real"]
            r["arrives_in_s"] = (r["deliver_real"] - now) if r["status"] == "in_flight" else None
        return rows
