"""Space Health Management System (SHMS) - FastAPI entry point. Serves the API and the built React app."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import routes
from .config import ROOT
from .i18n import LangMiddleware
from .state import AppState

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
DIST = ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = AppState()
    routes.STATE = state
    state.start()
    yield
    await state.stop()


app = FastAPI(title="Space Health Management System (SHMS) (simulated data)", lifespan=lifespan)
app.add_middleware(LangMiddleware)
app.include_router(routes.router)
app.include_router(routes.ws_router)


@app.get("/api/health")
async def health():
    return {"ok": True, "simulated": True}


if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    if path.startswith("api/") or path.startswith("ws/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    f = DIST / path
    if path and f.is_file() and DIST in f.resolve().parents:
        return FileResponse(f)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "Frontend not built. Run ./run.sh"}, status_code=503)
