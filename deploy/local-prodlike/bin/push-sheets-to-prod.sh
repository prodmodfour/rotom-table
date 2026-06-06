#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../lib/common.sh
. "$SCRIPT_DIR/../lib/common.sh"

LOCAL_SHEETS="$CAMPAIGN_DIR/data/sheets/"
PROD_SHEETS_DIR="$PROD_CAMPAIGN_ROOT/data/sheets"
PROD_SHEETS="$PROD_SSH:$PROD_SHEETS_DIR/"
APPLY=0
DELETE=0

usage() {
  cat <<'EOF'
Usage: push-sheets-to-prod.sh [--apply] [--delete]

Default: dry-run only. No production changes are made.

--apply   Actually push local Ranger sheets to production. Before pushing, the
          script creates a production backup over SSH.
--delete  Only valid together with --apply. Adds rsync --delete so production
          sheets missing locally are deleted. Use with extreme care.

Optional overrides:
  ROTOM_PROD_SSH=root@142.93.40.213
  ROTOM_PROD_CAMPAIGN_ROOT=/srv/rotom-table/campaigns/ranger
  ROTOM_PROD_BACKUP_DIR=/srv/rotom-table/backups/ranger
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --delete) DELETE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done

[ -d "$LOCAL_SHEETS" ] || fail "Missing local sheets directory: $LOCAL_SHEETS"

if [ "$DELETE" -eq 1 ] && [ "$APPLY" -ne 1 ]; then
  fail "--delete is only allowed when --apply is also passed"
fi

log "$CAMPAIGN_NAME sheets production sync helper"
printf 'Local source:      %s\n' "$LOCAL_SHEETS"
printf 'Production target: %s\n' "$PROD_SHEETS"
printf 'Production host:   %s\n' "$PROD_SSH"

if [ "$APPLY" -ne 1 ]; then
  printf '\nDRY RUN ONLY: no production backup, write, delete, chown, restart, or health check will run.\n'
  printf 'Command preview: rsync -av --dry-run %s %s\n\n' "$LOCAL_SHEETS" "$PROD_SHEETS"
  rsync -av --dry-run "$LOCAL_SHEETS" "$PROD_SHEETS"
  printf '\nDry run complete. To actually push, run: %s --apply\n' "$0"
  exit 0
fi

printf '\nREAL PRODUCTION PUSH REQUESTED (--apply).\n'
printf 'A production backup will be created before rsync writes anything.\n'
if [ "$DELETE" -eq 1 ]; then
  printf 'WARNING: --delete is enabled because both --apply and --delete were passed.\n'
else
  printf 'Safe default: rsync --delete is NOT enabled.\n'
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
REMOTE_BACKUP="$PROD_BACKUP_DIR/sheets-before-local-push-$timestamp.tar.gz"

log "Creating production backup before local push"
printf 'Backup path on production: %s\n' "$REMOTE_BACKUP"
ssh "$PROD_SSH" "mkdir -p '$PROD_BACKUP_DIR' && tar -C '$PROD_CAMPAIGN_ROOT/data' -czf '$REMOTE_BACKUP' sheets"

log "Pushing sheets to production"
if [ "$DELETE" -eq 1 ]; then
  printf 'Command: rsync -av --delete %s %s\n' "$LOCAL_SHEETS" "$PROD_SHEETS"
  rsync -av --delete "$LOCAL_SHEETS" "$PROD_SHEETS"
else
  printf 'Command: rsync -av %s %s\n' "$LOCAL_SHEETS" "$PROD_SHEETS"
  rsync -av "$LOCAL_SHEETS" "$PROD_SHEETS"
fi

log "Fixing production ownership, restarting service, and checking local production health"
ssh "$PROD_SSH" "chown -R rotom-table:rotom-table '$PROD_SHEETS_DIR' && systemctl restart rotom-table.service && curl -fsS http://127.0.0.1:3000/api/health"
printf '\nProduction push complete. Backup created at: %s\n' "$REMOTE_BACKUP"
