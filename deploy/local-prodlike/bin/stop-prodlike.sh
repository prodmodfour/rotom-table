#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

if [ ! -f "$PRODLIKE_PID_FILE" ]; then
  log "No local prodlike PID file found"
  exit 0
fi

PID=$(tr -d '[:space:]' < "$PRODLIKE_PID_FILE")
case "$PID" in
  ''|*[!0-9]*)
    log "Invalid PID file contents; removing $PRODLIKE_PID_FILE"
    rm -f "$PRODLIKE_PID_FILE"
    exit 0
    ;;
esac

if ! kill -0 "$PID" 2>/dev/null; then
  log "PID $PID is not running; removing stale PID file"
  rm -f "$PRODLIKE_PID_FILE"
  exit 0
fi

if ! pid_looks_like_prodlike "$PID"; then
  log "PID $PID does not look like this workspace's prodlike server; not killing it"
  log "Removing $PRODLIKE_PID_FILE so future starts are not blocked"
  rm -f "$PRODLIKE_PID_FILE"
  exit 0
fi

log "Stopping local prodlike process PID $PID"
kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
for _ in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PRODLIKE_PID_FILE"
    log "Stopped"
    exit 0
  fi
  sleep 0.5
done

log "Process did not stop after SIGTERM; sending SIGKILL"
kill -KILL -- "-$PID" 2>/dev/null || kill -KILL "$PID" 2>/dev/null || true
rm -f "$PRODLIKE_PID_FILE"
log "Stopped"
