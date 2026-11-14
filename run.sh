#!/usr/bin/env bash
# Crew Health Hub - one command to set up and start everything.
#
#   ./run.sh          set up (first run), build the UI, start on http://localhost:8000
#   ./run.sh test     run the pytest suite
#   ./run.sh dev      backend on :8000 + Vite dev server with hot reload on :5173
#
# Env: PORT (default 8000), HOST (default 127.0.0.1), HUB_SEED (default 42 from config).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

# Node: use the system one, or a local copy in ~/.local/node (no sudo needed).
if ! command -v node >/dev/null 2>&1 && [ -x "$HOME/.local/node/bin/node" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2" >&2; exit 1; }; }
need python3 "Install Python 3.11+."

# --- backend ---------------------------------------------------------------
VENV="$ROOT/backend/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "==> Creating Python virtual environment"
  python3 -m venv "$VENV"
fi
if [ ! -f "$VENV/.deps-installed" ] || [ "$ROOT/backend/requirements.txt" -nt "$VENV/.deps-installed" ]; then
  echo "==> Installing Python packages"
  "$VENV/bin/python" -m pip install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  touch "$VENV/.deps-installed"
fi

if [ "${1:-}" = "test" ]; then
  cd "$ROOT/backend" && exec "$VENV/bin/pytest" -q "${@:2}"
fi

# --- frontend --------------------------------------------------------------
need node "Install Node.js 18+ (or unpack it into ~/.local/node)."
need npm "Install npm."
cd "$ROOT/frontend"
if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo "==> Installing frontend packages"
  npm install --no-audit --no-fund
fi

if [ "${1:-}" = "dev" ]; then
  cd "$ROOT/backend"
  "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT" &
  BACK=$!
  trap 'kill $BACK 2>/dev/null' EXIT
  cd "$ROOT/frontend" && npx vite --host "$HOST"
  exit 0
fi

if [ ! -f dist/index.html ] || [ -n "$(find src index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> Building the UI"
  npm run build
fi

cd "$ROOT/backend"
echo ""
echo "  Crew Health Hub (SIMULATED DATA - decision-support demo, not a medical device)"
echo "  Crew app:      http://$HOST:$PORT/"
echo "  Surgeon view:  http://$HOST:$PORT/surgeon"
echo ""
exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT"
