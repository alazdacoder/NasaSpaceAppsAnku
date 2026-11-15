"""Desktop launcher for Space Health Management System (SHMS) (used for the Windows .exe).

Starts the server on 127.0.0.1, picks a free port if 8000 is taken, waits until it
answers, then opens the start page in the default browser. Close the window (or press
Ctrl+C) to stop.

    SpaceHealthManagementSystem.exe [--port 8000] [--seed 42] [--no-browser]
"""
from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser


def free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 50)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_when_ready(url: str, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "api/health", timeout=1):
                webbrowser.open(url)
                return
        except Exception:
            time.sleep(0.4)


def main() -> None:
    try:
        sys.stdout.reconfigure(line_buffering=True)  # show the URL lines immediately
    except Exception:
        pass
    ap = argparse.ArgumentParser(prog="SpaceHealthManagementSystem", description="Space Health Management System (SHMS) (simulated data demo)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--seed", type=int, default=None, help="simulation seed (default 42)")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = ap.parse_args()
    if args.seed is not None:
        os.environ["HUB_SEED"] = str(args.seed)

    import uvicorn

    from app.config import DATA_DIR
    from app.main import app

    port = free_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    print("")
    print("  Space Health Management System (SHMS)  -  SIMULATED DATA - decision-support demo, not a medical device")
    print(f"  Start page:        {url}")
    print(f"  Astronaut portal:  {url}crew")
    print(f"  Lab team portal:   {url}team")
    print(f"  Data folder:   {DATA_DIR}")
    print("  Close this window or press Ctrl+C to stop.")
    print("")
    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # keep the console open so the user can read the error
        print(f"\nSpace Health Management System (SHMS) could not start: {exc!r}")
        if getattr(sys, "frozen", False) and sys.platform == "win32":
            input("Press Enter to close...")
        raise
