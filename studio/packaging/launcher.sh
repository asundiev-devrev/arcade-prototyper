#!/bin/bash
# Arcade Studio launcher — runs inside Contents/MacOS/ of the .app bundle.
# Starts the Vite dev server with the bundled Node runtime, opens the browser,
# and keeps the process alive so the .app shows as running in the Dock.
set -euo pipefail

# Resolve the bundle root (the .app folder) from this script's own path.
# launcher.sh lives at <App>/Contents/MacOS/Arcade Studio — so two "../"
# lands at Contents/, and one more at the .app.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES="$SCRIPT_DIR/../Resources"
APP_DIR="$RESOURCES/app"
NODE_BIN="$RESOURCES/node/bin"
LOCAL_BIN="$APP_DIR/node_modules/.bin"

# $NODE_BIN first so `node` resolves to the bundled runtime.
# $LOCAL_BIN second so `figmanage`, `vite`, and `claude` all resolve from
# the bundle's node_modules without the host having them installed globally.
export PATH="$NODE_BIN:$LOCAL_BIN:$PATH"

# Point claudeBin.ts at the vendored install; belt-and-suspenders alongside
# $LOCAL_BIN on $PATH.
export ARCADE_STUDIO_CLAUDE_BIN="$LOCAL_BIN/claude"

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/arcade-studio.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# If port 5556 is already bound, assume a previous launch is still running.
# Just open the browser against the existing server and exit.
if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
  log "Port 5556 already in use — opening existing server"
  open "http://localhost:5556"
  exit 0
fi

log "Starting Vite from $APP_DIR"
cd "$APP_DIR"

# Vite has `open: true` in its config, so it opens the browser itself once
# listening. We still run `open` below as a safety net for cases where the
# user closed the tab — idempotent.
"$NODE_BIN/node" ./node_modules/.bin/vite --config studio/vite.config.ts >> "$LOG_FILE" 2>&1 &
VITE_PID=$!

# Wait up to 30s for the port to be ready, then open the browser defensively.
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
    open "http://localhost:5556"
    break
  fi
  sleep 0.5
done

# Stay attached so macOS shows the app as running and quitting it kills Vite.
trap 'log "Shutting down"; kill "$VITE_PID" 2>/dev/null || true; exit 0' TERM INT
wait "$VITE_PID"
