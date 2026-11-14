# PyInstaller spec: one-file executable with the backend, the built UI and the config.
# Build (from the repo root, after `npm run build` in frontend/):
#     pyinstaller --noconfirm packaging/CrewHealthHub.spec
# Output: dist/CrewHealthHub(.exe)
import os
from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
BACKEND = os.path.join(ROOT, "backend")
DIST_UI = os.path.join(ROOT, "frontend", "dist")
if not os.path.exists(os.path.join(DIST_UI, "index.html")):
    raise SystemExit("frontend/dist is missing - run `npm run build` in frontend/ first")

hidden = (collect_submodules("uvicorn") + collect_submodules("websockets")
          + collect_submodules("app") + ["h11", "anyio._backends._asyncio"])

a = Analysis(
    [os.path.join(BACKEND, "launcher.py")],
    pathex=[BACKEND],
    datas=[
        (os.path.join(ROOT, "config", "reference.yaml"), "config"),
        (os.path.join(ROOT, "config", "osdr_fallback.json"), "config"),
        (DIST_UI, os.path.join("frontend", "dist")),
    ],
    hiddenimports=hidden,
    excludes=["pytest", "tkinter", "matplotlib", "IPython", "uvloop", "watchfiles"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="CrewHealthHub",
    console=True,          # the console window shows the URL; closing it stops the app
    upx=False,
    icon=os.path.join(SPECPATH, "icon.ico") if os.path.exists(os.path.join(SPECPATH, "icon.ico")) else None,
)
