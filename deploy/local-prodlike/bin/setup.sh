#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

ensure_app_checkout

log "Creating local production-like workspace for campaign: $CAMPAIGN_NAME"
ensure_workspace_dirs
write_env_files

log "Verifying Node 24"
ensure_node24
export NPM_CONFIG_CACHE="$NPM_CACHE_DIR"
printf 'Using Node %s and npm %s\n' "$(node --version)" "$(npm --version)"

log "Verifying package.json Node engine"
engine=$(cd "$APP_DIR" && node -e 'const p=require("./package.json"); process.stdout.write((p.engines && p.engines.node) || "")')
[ "$engine" = ">=24 <25" ] || fail "Expected package.json engines.node to be '>=24 <25', found '$engine'"

if [ -d "$APP_DIR/.git" ]; then
  log "Current app checkout"
  git -C "$APP_DIR" rev-parse --abbrev-ref HEAD || true
  git -C "$APP_DIR" rev-parse HEAD || true
fi

log "Installing dependencies with npm ci"
cd "$APP_DIR"
npm ci

log "Building production output"
npm run build

log "Setup complete"
printf 'Workspace root: %s\n' "$WORKSPACE_ROOT"
printf 'Campaign root:  %s\n' "$CAMPAIGN_DIR"
printf 'Prodlike env:   %s\n' "$PRODLIKE_ENV_FILE"
printf 'Dev env:        %s\n' "$DEV_ENV_FILE"
printf '\nNext commands:\n'
printf '  %s/validate.sh\n' "$SCRIPT_DIR"
printf '  %s/start-prodlike.sh\n' "$SCRIPT_DIR"
printf '  %s/health-prodlike.sh\n' "$SCRIPT_DIR"
