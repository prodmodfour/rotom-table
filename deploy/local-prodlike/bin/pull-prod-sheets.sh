#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

SRC="$PROD_SSH:$PROD_CAMPAIGN_ROOT/data/sheets/"
DEST="$CAMPAIGN_DIR/data/sheets/"

mkdir -p "$DEST"

log "Pulling only production $CAMPAIGN_NAME sheets"
printf 'From: %s\n' "$SRC"
printf 'To:   %s\n' "$DEST"
printf 'Command: rsync -av %s %s\n' "$SRC" "$DEST"
printf 'Note: --delete is intentionally NOT used. Existing local files not present on production will remain.\n'
rsync -av "$SRC" "$DEST"
printf 'Done.\n'
