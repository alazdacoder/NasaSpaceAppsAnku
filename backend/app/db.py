"""SQLite storage. One onboard database; the 'ground' tables only receive data
that arrived through the simulated ground link."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS samples (
    crew_id TEXT, day INTEGER, metric TEXT, value REAL, source TEXT,
    PRIMARY KEY (crew_id, day, metric)
);
CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT, day INTEGER, device TEXT,
    minutes REAL, avg_hr REAL, max_hr REAL, details TEXT, source TEXT, created_real REAL
);
CREATE TABLE IF NOT EXISTS manual_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT, day INTEGER, kind TEXT,
    payload TEXT, created_real REAL, mission_t REAL
);
CREATE TABLE IF NOT EXISTS tasks (
    crew_id TEXT, day INTEGER, task_id TEXT, kind TEXT, title TEXT, detail TEXT,
    status TEXT, confirmed_mission_t REAL, payload TEXT,
    PRIMARY KEY (crew_id, day, task_id)
);
CREATE TABLE IF NOT EXISTS protocols (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT, type TEXT, start_day INTEGER,
    end_day INTEGER, status TEXT, started_by TEXT, reason TEXT
);
CREATE TABLE IF NOT EXISTS doses (
    crew_id TEXT, day INTEGER, protocol_id INTEGER, taken INTEGER, source TEXT,
    PRIMARY KEY (crew_id, day, protocol_id)
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT, kind TEXT, start_day INTEGER,
    end_day INTEGER, params TEXT, origin TEXT, created_real REAL
);
CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id TEXT, mission_t REAL, created_real REAL,
    kind TEXT, level TEXT, text TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY, crew_id TEXT, kind TEXT, payload TEXT, mission_t REAL,
    created_real REAL, sent_real REAL, deliver_real REAL, ack_real REAL, status TEXT
);
CREATE TABLE IF NOT EXISTS g_samples (
    crew_id TEXT, day INTEGER, metric TEXT, value REAL,
    PRIMARY KEY (crew_id, day, metric)
);
CREATE TABLE IF NOT EXISTS g_state (
    crew_id TEXT PRIMARY KEY, payload TEXT, mission_t REAL, created_real REAL, received_real REAL, seq INTEGER
);
CREATE TABLE IF NOT EXISTS g_event_log (
    seq INTEGER, crew_id TEXT, mission_t REAL, created_real REAL, received_real REAL,
    kind TEXT, level TEXT, text TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_cm ON samples(crew_id, metric, day);
CREATE INDEX IF NOT EXISTS idx_gsamples_cm ON g_samples(crew_id, metric, day);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
"""


class DB:
    def __init__(self, path: str | Path = ":memory:", fresh: bool = True):
        if path != ":memory:":
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            if fresh:
                try:
                    for suffix in ("", "-wal", "-shm"):
                        Path(str(p) + suffix).unlink(missing_ok=True)
                except OSError:
                    # Windows: another running copy still has the file open - use our own file.
                    p = p.with_name(f"{p.stem}-{os.getpid()}{p.suffix}")
            path = p
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.execute("PRAGMA synchronous = OFF")

    # -- helpers ---------------------------------------------------------
    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, tuple(params))

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]]) -> None:
        self.conn.executemany(sql, rows)

    def all(self, sql: str, params: Iterable[Any] = ()) -> list[dict]:
        return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    def one(self, sql: str, params: Iterable[Any] = ()) -> dict | None:
        r = self.conn.execute(sql, tuple(params)).fetchone()
        return dict(r) if r else None

    def transaction(self):
        return _Tx(self.conn)

    # -- samples ---------------------------------------------------------
    def put_samples(self, crew_id: str, day: int, values: dict[str, float], source: str, table: str = "samples") -> None:
        if table == "samples":
            self.executemany(
                "INSERT OR REPLACE INTO samples(crew_id, day, metric, value, source) VALUES (?,?,?,?,?)",
                [(crew_id, day, m, float(v), source) for m, v in values.items() if v is not None])
        else:
            self.executemany(
                "INSERT OR REPLACE INTO g_samples(crew_id, day, metric, value) VALUES (?,?,?,?)",
                [(crew_id, day, m, float(v)) for m, v in values.items() if v is not None])

    def series(self, crew_id: str, table: str = "samples", max_day: int | None = None) -> dict[str, tuple[list[int], list[float]]]:
        sql = f"SELECT metric, day, value FROM {table} WHERE crew_id=?"
        params: list[Any] = [crew_id]
        if max_day is not None:
            sql += " AND day<=?"
            params.append(max_day)
        sql += " ORDER BY metric, day"
        out: dict[str, tuple[list[int], list[float]]] = {}
        for r in self.conn.execute(sql, params):
            d, v = out.setdefault(r["metric"], ([], []))
            d.append(r["day"])
            v.append(r["value"])
        return out


class _Tx:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def __enter__(self):
        self.conn.execute("BEGIN")
        return self

    def __exit__(self, exc_type, *_):
        self.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        return False


def dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), default=float)
