"""Starts the Space Health Management System (SHMS) server inside the Android app (Chaquopy).

The whole app runs on the phone: this module starts the same FastAPI server as the
desktop version on 127.0.0.1, and MainActivity shows it in a WebView. The build copies
backend/app, config/ and frontend/dist next to this file (see android/prepare.sh).
"""
from __future__ import annotations

import importlib.util
import logging
import os
import threading
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
_state: dict = {"error": None, "started": False, "finished": False}


class _ErrorLog(logging.Handler):
    """Keeps the last error the server logged, so the app can show it."""

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno >= logging.ERROR:
            _state["error"] = self.format(record)


def start(port: int = 8765) -> None:
    """Import the app and start the server in a background thread (returns at once)."""
    if _state["started"]:
        return
    os.environ.setdefault("HUB_ROOT", HERE)                       # config/ and frontend/dist live here
    data = os.path.join(os.environ.get("HOME") or HERE, "crewhub-data")   # writable app storage
    os.makedirs(data, exist_ok=True)
    os.environ.setdefault("HUB_DATA_DIR", data)

    handler = _ErrorLog()
    handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))
    logging.getLogger().addHandler(handler)

    import uvicorn                     # noqa: E402  (after the environment is set)
    from app.main import app           # noqa: E402

    ws = "wsproto" if importlib.util.find_spec("wsproto") else "auto"     # wsproto is pure Python (phone)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, ws=ws, loop="asyncio", lifespan="on",
                            log_level="warning", access_log=False)
    server = uvicorn.Server(config)

    def run() -> None:
        try:
            server.run()
        except BaseException:          # keep the reason for the error screen
            _state["error"] = traceback.format_exc()
        else:
            _state["error"] = _state["error"] or "The server stopped."
        finally:
            _state["finished"] = True

    _state["started"] = True
    threading.Thread(target=run, name="crewhub-server", daemon=True).start()


def error() -> str | None:
    """Why the server stopped, once it has stopped (shown by MainActivity); None while it runs."""
    return _state["error"] if _state["finished"] else None
