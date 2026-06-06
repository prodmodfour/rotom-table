#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ensure_app_checkout
ensure_workspace_dirs

log "Stopping any existing local prodlike process for this workspace"
"$SCRIPT_DIR/stop-prodlike.sh"

log "Loading $PRODLIKE_ENV_FILE"
load_env_file "$PRODLIKE_ENV_FILE"

PORT=${NITRO_PORT:-$DEFAULT_NITRO_PORT}
if port_is_listening "$PORT"; then
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep ":$PORT" >&2 || true
  fi
  fail "Port $PORT is already in use. Stop the unrelated local server before starting prodlike mode."
fi

ensure_node24
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"

cd "$APP_DIR"
if [ ! -f "$APP_DIR/.output/server/index.mjs" ]; then
  log "Production output is missing; running npm run build"
  npm run build
fi

log "Starting local production-like Rotom Table"
printf '\n[%s] Starting prodlike server with NODE_ENV=%s NITRO_HOST=%s NITRO_PORT=%s ROTOM_CAMPAIGN_ROOT=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${NODE_ENV:-}" "${NITRO_HOST:-}" "${NITRO_PORT:-}" "${ROTOM_CAMPAIGN_ROOT:-}" >> "$PRODLIKE_LOG_FILE"

if command -v setsid >/dev/null 2>&1; then
  setsid bash -c 'exec npm run start' >> "$PRODLIKE_LOG_FILE" 2>&1 &
else
  bash -c 'exec npm run start' >> "$PRODLIKE_LOG_FILE" 2>&1 &
fi
PID=$!
printf '%s\n' "$PID" > "$PRODLIKE_PID_FILE"
log "Started PID $PID; logs: $PRODLIKE_LOG_FILE"

log "Waiting for health endpoint $HEALTH_URL"
for _ in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then
    tail -80 "$PRODLIKE_LOG_FILE" >&2 || true
    fail "Prodlike process exited before health check passed"
  fi
  if response=$(curl -fsS "$HEALTH_URL" 2>/dev/null); then
    printf 'Health OK: %s\n' "$response"
    printf 'Local prodlike URL: %s\n' "$LOCAL_URL"
    exit 0
  fi
  sleep 1
done

tail -80 "$PRODLIKE_LOG_FILE" >&2 || true
fail "Health check did not pass within 60 seconds. PID $PID may still be running; use stop-prodlike.sh if needed."
