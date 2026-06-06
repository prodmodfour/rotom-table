#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

if [ -f "$PRODLIKE_ENV_FILE" ]; then
  load_env_file "$PRODLIKE_ENV_FILE"
fi

if [ ! -f "$PRODLIKE_PID_FILE" ]; then
  printf 'Health check failed: no local prodlike PID file found. Run start-prodlike.sh first.\n' >&2
  exit 1
fi
PID=$(tr -d '[:space:]' < "$PRODLIKE_PID_FILE")
case "$PID" in
  ''|*[!0-9]*)
    printf 'Health check failed: invalid PID file %s.\n' "$PRODLIKE_PID_FILE" >&2
    exit 1
    ;;
esac
if ! kill -0 "$PID" 2>/dev/null; then
  printf 'Health check failed: local prodlike PID %s is not running.\n' "$PID" >&2
  exit 1
fi
if ! pid_looks_like_prodlike "$PID"; then
  printf 'Health check failed: PID %s does not look like this workspace prodlike server.\n' "$PID" >&2
  exit 1
fi

printf '==> Checking local prodlike health: %s\n' "$HEALTH_URL"
if response=$(curl -fsS "$HEALTH_URL" 2>/dev/null); then
  printf 'Health OK: %s\n' "$response"
else
  printf 'Health check failed. See %s.\n' "$PRODLIKE_LOG_FILE" >&2
  exit 1
fi
