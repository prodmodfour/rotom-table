#!/usr/bin/env bash
# Shared helpers for local production-like Rotom Table workspace scripts.
# shellcheck shell=bash

COMMON_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TOOL_ROOT=$(CDPATH= cd -- "$COMMON_DIR/.." && pwd)
APP_DIR=$(CDPATH= cd -- "$TOOL_ROOT/../.." && pwd)
WORKSPACE_ROOT=${ROTOM_WORKSPACE_ROOT:-$(CDPATH= cd -- "$APP_DIR/.." && pwd)}
CAMPAIGN_NAME=${ROTOM_CAMPAIGN_NAME:-ranger}
CAMPAIGN_DIR="$WORKSPACE_ROOT/campaigns/$CAMPAIGN_NAME"
ENV_DIR="$WORKSPACE_ROOT/env"
BACKUP_DIR="$WORKSPACE_ROOT/backups/$CAMPAIGN_NAME"
LOG_DIR="$WORKSPACE_ROOT/logs"
RUN_DIR="$WORKSPACE_ROOT/run"
NPM_CACHE_DIR="$WORKSPACE_ROOT/.npm"
PRODLIKE_ENV_FILE="$ENV_DIR/$CAMPAIGN_NAME.prodlike.env"
DEV_ENV_FILE="$ENV_DIR/$CAMPAIGN_NAME.dev.env"
PRODLIKE_LOG_FILE="$LOG_DIR/rotom-table-prodlike.log"
PRODLIKE_PID_FILE="$RUN_DIR/rotom-table-prodlike.pid"
DEFAULT_NITRO_HOST="127.0.0.1"
DEFAULT_NITRO_PORT="3000"
HEALTH_URL="http://$DEFAULT_NITRO_HOST:$DEFAULT_NITRO_PORT/api/health"
LOCAL_URL="http://$DEFAULT_NITRO_HOST:$DEFAULT_NITRO_PORT"
PROD_SSH=${ROTOM_PROD_SSH:-root@142.93.40.213}
PROD_CAMPAIGN_ROOT=${ROTOM_PROD_CAMPAIGN_ROOT:-/srv/rotom-table/campaigns/ranger}
PROD_BACKUP_DIR=${ROTOM_PROD_BACKUP_DIR:-/srv/rotom-table/backups/ranger}

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ensure_workspace_dirs() {
  mkdir -p \
    "$CAMPAIGN_DIR/data/maps" \
    "$CAMPAIGN_DIR/data/sheets" \
    "$CAMPAIGN_DIR/data/trainers" \
    "$CAMPAIGN_DIR/data/player-profiles" \
    "$CAMPAIGN_DIR/data/reference-overrides" \
    "$CAMPAIGN_DIR/encounter_tables" \
    "$BACKUP_DIR" \
    "$ENV_DIR" \
    "$LOG_DIR" \
    "$RUN_DIR" \
    "$NPM_CACHE_DIR"
}

ensure_app_checkout() {
  [ -f "$APP_DIR/package.json" ] || fail "Missing Rotom Table package.json at $APP_DIR/package.json"
}

ensure_node24() {
  if command -v node >/dev/null 2>&1; then
    major=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || true)
    if [ "$major" = "24" ]; then
      return 0
    fi
  fi

  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    log "Switching to Node 24 via nvm"
    set +u
    # shellcheck source=/dev/null
    . "$HOME/.nvm/nvm.sh"
    if ! nvm use 24 >/dev/null 2>&1; then
      nvm install 24
      nvm use 24 >/dev/null
    fi
    set -u
  elif command -v fnm >/dev/null 2>&1; then
    log "Switching to Node 24 via fnm"
    eval "$(fnm env --shell bash)"
    fnm use 24 >/dev/null 2>&1 || { fnm install 24; fnm use 24; }
  elif command -v volta >/dev/null 2>&1; then
    log "Installing/using Node 24 via Volta"
    volta install node@24
  elif command -v mise >/dev/null 2>&1; then
    log "Installing/using Node 24 via mise"
    mise use -g node@24
  elif command -v asdf >/dev/null 2>&1; then
    log "Installing/using Node 24 via asdf"
    asdf plugin add nodejs >/dev/null 2>&1 || true
    asdf install nodejs 24 latest >/dev/null 2>&1 || asdf install nodejs 24
    asdf local nodejs 24
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    write_node_manual_action
    fail "Node 24 and npm are required. Wrote $WORKSPACE_ROOT/LOCAL_SETUP_NEEDS_MANUAL_ACTION.md."
  fi
  version=$(node --version)
  major=${version#v}
  major=${major%%.*}
  if [ "$major" != "24" ]; then
    write_node_manual_action
    fail "Node 24 is required; current node is $version. Wrote $WORKSPACE_ROOT/LOCAL_SETUP_NEEDS_MANUAL_ACTION.md."
  fi
}

write_node_manual_action() {
  mkdir -p "$WORKSPACE_ROOT"
  cat > "$WORKSPACE_ROOT/LOCAL_SETUP_NEEDS_MANUAL_ACTION.md" <<'EOF_MANUAL'
# Local setup needs manual action

Node.js major version 24 is required for Rotom Table (`>=24 <25`), but the setup script could not switch to Node 24 automatically.

On Ubuntu/Debian-like Linux, install Node 24 with one of these one-line commands, then rerun `deploy/local-prodlike/bin/setup.sh` from the app checkout:

- With nvm: `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && . "$HOME/.nvm/nvm.sh" && nvm install 24 && nvm use 24`
- With NodeSource apt packages: `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs`

No secrets are required for this local setup.
EOF_MANUAL
}

write_env_files() {
  ensure_workspace_dirs
  cat > "$PRODLIKE_ENV_FILE" <<EOF_ENV
NODE_ENV=production
NITRO_HOST=$DEFAULT_NITRO_HOST
NITRO_PORT=$DEFAULT_NITRO_PORT
ROTOM_CAMPAIGN_ROOT=$CAMPAIGN_DIR
ROTOM_ENABLE_HOSTED_WRITES=1
NPM_CONFIG_CACHE=$NPM_CACHE_DIR
EOF_ENV
  cat > "$DEV_ENV_FILE" <<EOF_ENV
NODE_ENV=development
NITRO_HOST=$DEFAULT_NITRO_HOST
NITRO_PORT=$DEFAULT_NITRO_PORT
ROTOM_CAMPAIGN_ROOT=$CAMPAIGN_DIR
ROTOM_ENABLE_HOSTED_WRITES=1
NPM_CONFIG_CACHE=$NPM_CACHE_DIR
EOF_ENV
}

load_env_file() {
  env_file=$1
  [ -f "$env_file" ] || fail "Missing env file $env_file. Run setup.sh first."
  set -a
  # shellcheck source=/dev/null
  . "$env_file"
  set +a
  HEALTH_URL="http://${NITRO_HOST:-$DEFAULT_NITRO_HOST}:${NITRO_PORT:-$DEFAULT_NITRO_PORT}/api/health"
  LOCAL_URL="http://${NITRO_HOST:-$DEFAULT_NITRO_HOST}:${NITRO_PORT:-$DEFAULT_NITRO_PORT}"
}

pid_looks_like_prodlike() {
  pid=$1
  cmd=""
  cwd=""
  if [ -r "/proc/$pid/cmdline" ]; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" || true)
  fi
  if [ -e "/proc/$pid/cwd" ]; then
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  fi
  case "$cwd $cmd" in
    *"$APP_DIR"*"npm run start"*|*"$APP_DIR"*".output/server/index.mjs"*|*"$APP_DIR"*"exec npm run start"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

port_is_listening() {
  port=$1
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}
