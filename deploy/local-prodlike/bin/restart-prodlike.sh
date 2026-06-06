#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

printf '==> Restarting local prodlike Rotom Table\n'
"$SCRIPT_DIR/stop-prodlike.sh"
"$SCRIPT_DIR/start-prodlike.sh"
