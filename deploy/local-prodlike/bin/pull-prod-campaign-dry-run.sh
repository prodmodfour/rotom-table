#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

SRC="$PROD_SSH:$PROD_CAMPAIGN_ROOT/"
DEST="$CAMPAIGN_DIR/"

mkdir -p "$DEST"

log "DRY RUN: preview full production $CAMPAIGN_NAME campaign pull"
printf 'From: %s\n' "$SRC"
printf 'To:   %s\n' "$DEST"
printf 'Command: rsync -av --dry-run %s %s\n' "$SRC" "$DEST"
printf 'No local files will be changed. --delete is intentionally NOT used.\n\n'
rsync -av --dry-run "$SRC" "$DEST"
printf '\nDry run complete. No changes were applied.\n'
