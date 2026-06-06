#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

[ -d "$CAMPAIGN_DIR" ] || fail "Missing campaign directory: $CAMPAIGN_DIR"
mkdir -p "$BACKUP_DIR"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$BACKUP_DIR/$CAMPAIGN_NAME-local-$timestamp.tar.gz"

log "Backing up local $CAMPAIGN_NAME campaign"
printf 'Source: %s\n' "$CAMPAIGN_DIR"
printf 'Backup: %s\n' "$backup_path"
tar -C "$WORKSPACE_ROOT/campaigns" -czf "$backup_path" "$CAMPAIGN_NAME"
printf 'Backup written: %s\n' "$backup_path"
