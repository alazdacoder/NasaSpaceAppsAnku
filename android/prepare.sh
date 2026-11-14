#!/usr/bin/env bash
# Copies the app into the Android project before a Gradle build:
#   backend/app, config/ and frontend/dist  ->  android/app/src/main/python/
# Run from anywhere; build the UI first (cd frontend && npm run build).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/android/app/src/main/python"
[ -f "$ROOT/frontend/dist/index.html" ] || { echo "Build the UI first: cd frontend && npm run build" >&2; exit 1; }
rm -rf "$PY/app" "$PY/config" "$PY/frontend"
mkdir -p "$PY/frontend"
cp -r "$ROOT/backend/app" "$PY/app"
cp -r "$ROOT/config" "$PY/config"
cp -r "$ROOT/frontend/dist" "$PY/frontend/dist"
find "$PY" -name "__pycache__" -type d -prune -exec rm -rf {} +
echo "Staged the app for Android in $PY"
