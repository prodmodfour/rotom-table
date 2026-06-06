#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ensure_app_checkout
ensure_node24
export NODE_OPTIONS=--max-old-space-size=3072
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"

log "Validating with Node $(node --version), npm $(npm --version)"
cd "$APP_DIR"
log "Running npm run typecheck"
npm run typecheck
log "Running npm test"
npm test
log "Running npm run build"
npm run build
log "Validation complete"
