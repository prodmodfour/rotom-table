#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ensure_app_checkout
ensure_workspace_dirs
if [ ! -f "$DEV_ENV_FILE" ]; then
  write_env_files
fi

log "Loading $DEV_ENV_FILE"
load_env_file "$DEV_ENV_FILE"
ensure_node24
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"

log "Starting normal Nuxt dev mode with npm run dev"
printf 'Note: start-prodlike.sh is the closer production mimic.\n'
cd "$APP_DIR"
exec npm run dev
