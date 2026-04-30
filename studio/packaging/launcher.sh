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

# ── AWS Bedrock bootstrap ────────────────────────────────────────────────────
# New users on a fresh Mac need ~/.aws/config populated with our org's SSO
# profile before `claude` can reach Bedrock. Rather than making each beta
# tester paste the block manually (from studio/docs/aws-setup.md), we
# idempotently append it on first launch.
#
# We never overwrite an existing [profile dev] block — if the user already
# has one configured (maybe pointing at a different role), we leave it alone.
# Only add the block when it's missing entirely. Detection uses a literal
# line match, not parsing, so any ini-like variation the user might have
# counts as "already present".
AWS_CONFIG_DIR="$HOME/.aws"
AWS_CONFIG_FILE="$AWS_CONFIG_DIR/config"
if ! grep -q "^\[profile dev\]" "$AWS_CONFIG_FILE" 2>/dev/null; then
  mkdir -p "$AWS_CONFIG_DIR"
  # Leading newline keeps us safe if the existing file doesn't end with one.
  # These values match the DevRev Bedrock SSO portal. If they change, both
  # this block AND studio/docs/aws-setup.md must be updated in lockstep.
  {
    printf '\n[profile dev]\n'
    printf 'sso_start_url = https://d-9067645937.awsapps.com/start#\n'
    printf 'sso_region = us-east-1\n'
    printf 'sso_account_id = 020040093233\n'
    printf 'sso_role_name = BedrockLongLivedTokenAccess\n'
    printf 'region = us-east-1\n'
  } >> "$AWS_CONFIG_FILE"
  log "Installed [profile dev] into $AWS_CONFIG_FILE"
fi

# Make every `claude` / `aws` call in this session use the SSO profile by
# default, without the user editing their ~/.zshrc. The app inherits this;
# their shell stays untouched so their other CLI tools aren't affected.
export AWS_PROFILE="${AWS_PROFILE:-dev}"

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/arcade-studio.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# If port 5556 is bound AND the server is actually responding to HTTP,
# a previous launch is healthy — just open the browser and exit.
#
# If the port is bound but nothing is answering (zombie process, crashed
# Vite, stale lock), we can't trust the short-circuit. Kill whatever is
# holding the port so this launch can start fresh. Common trigger: user
# closed the browser tab but Vite kept running, then the user quits the
# Dock icon — the trap kills launcher but Vite detached and survived.
if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -sfo /dev/null --max-time 2 "http://localhost:5556/"; then
    log "Port 5556 responding — opening existing server"
    open "http://localhost:5556"
    exit 0
  fi
  log "Port 5556 bound but not responding — killing zombie and restarting"
  STALE_PIDS=$(lsof -ti:5556 2>/dev/null || true)
  if [ -n "$STALE_PIDS" ]; then
    # SIGTERM first, wait briefly, SIGKILL if it won't die. Never send to
    # PIDs outside our user's processes (lsof -t already filters by default).
    echo "$STALE_PIDS" | xargs kill 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if ! lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
      sleep 0.3
    done
    if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
      log "Stale process did not exit in 3s — SIGKILL"
      echo "$STALE_PIDS" | xargs kill -9 2>/dev/null || true
      sleep 0.5
    fi
  fi
fi

log "Starting Vite from $APP_DIR"
cd "$APP_DIR"

# Vite has `open: true` in its config, so it opens the browser itself once
# listening. We still run `open` below as a safety net for cases where the
# user closed the tab — idempotent.
#
# Invoke the JS entry directly with node. Do NOT pass `node_modules/.bin/vite`
# to node — that's a shell-script wrapper, and node would try to parse it as
# JavaScript and fail with "SyntaxError: missing ) after argument list".
#
# Run Vite in its own process group so we can nuke the whole tree on quit.
# Vite spawns watchers / helper processes that can survive a plain
# `kill $VITE_PID` otherwise and keep port 5556 bound post-quit.
set +m  # suppress job-control messages
"$NODE_BIN/node" ./node_modules/vite/bin/vite.js --config studio/vite.config.ts >> "$LOG_FILE" 2>&1 &
VITE_PID=$!

# Wait up to 30s for the port to be ready, then open the browser defensively.
for _ in $(seq 1 60); do
  if lsof -nP -iTCP:5556 -sTCP:LISTEN >/dev/null 2>&1; then
    open "http://localhost:5556"
    break
  fi
  sleep 0.5
done

# Clean shutdown handler. Kill the whole Vite process tree, not just the
# parent PID, so no child watcher keeps port 5556 bound and tricks the
# next launch into thinking Studio is still running.
cleanup() {
  log "Shutting down"
  # SIGTERM the whole tree rooted at VITE_PID.
  pkill -TERM -P "$VITE_PID" 2>/dev/null || true
  kill -TERM "$VITE_PID" 2>/dev/null || true
  # Give children 2s to exit cleanly, then SIGKILL any survivors.
  for _ in 1 2 3 4; do
    if ! kill -0 "$VITE_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  pkill -KILL -P "$VITE_PID" 2>/dev/null || true
  kill -KILL "$VITE_PID" 2>/dev/null || true
  # Belt-and-suspenders: anything still holding port 5556 now is
  # almost certainly our detached child. Nuke it so the next launch
  # doesn't hit the zombie-port short-circuit.
  STALE=$(lsof -ti:5556 2>/dev/null || true)
  if [ -n "$STALE" ]; then
    echo "$STALE" | xargs kill -9 2>/dev/null || true
  fi
  exit 0
}
trap cleanup TERM INT HUP EXIT
wait "$VITE_PID"
