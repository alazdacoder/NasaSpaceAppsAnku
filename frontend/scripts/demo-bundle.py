"""Web demo: zip the backend (app code + config) into dist/demo/backend.zip.

The GitHub Pages build runs this after `vite build`; the browser unpacks the zip into
Pyodide and runs the same FastAPI app the desktop and Android builds run.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Usage: python demo-bundle.py [dist folder]  (default frontend/dist)
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "frontend" / "dist"
OUT = DIST / "demo" / "backend.zip"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((ROOT / "backend" / "app").rglob("*.py")):
            z.write(f, f.relative_to(ROOT).as_posix())
        for f in sorted((ROOT / "config").iterdir()):
            if f.is_file():
                z.write(f, f.relative_to(ROOT).as_posix())
    print(f"{OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
