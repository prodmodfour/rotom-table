# Private VPS backup runbook

Use this runbook to create private backups of a trusted-table VPS campaign before and after play sessions, then smoke-check a restore before trusting an archive. It covers the SQLite-backed live-play database, residual JSON campaign files stored under `ROTOM_CAMPAIGN_ROOT`, campaign reference override diffs, and the private deployment settings needed to recreate the host. It does not make Rotom Table a public hosted service, and it does not encrypt archives for you.

## What to back up

Back up the entire configured campaign root, not only the file you edited most recently:

- `data/maps/` if retained as maintenance/export copies (not runtime authority)
- `data/sheets/` if retained as maintenance/export copies (not runtime authority)
- `data/trainers/` if retained as maintenance/export copies (not runtime authority)
- `data/group-inventories/` if retained as maintenance/export copies (not runtime authority)
- `data/shops/` if retained as maintenance/export copies (not runtime authority)
- `data/player-profiles/`
- `data/reference-overrides/` for campaign-owned reference override diffs such as Pokédex edits
- `encounter_tables/`
- `rotom-table.sqlite` plus `rotom-table.sqlite-wal` and `rotom-table.sqlite-shm` when live-play SQLite repositories have created them, or the configured `ROTOM_DB_PATH` and sidecars if the database uses another private campaign-storage path
- any private campaign assets or notes intentionally kept under the campaign root

For the documented VPS layout, the app runs from `/srv/rotom-table/app`, campaign data lives in `/srv/rotom-table/campaign`, the default SQLite database path is `/srv/rotom-table/campaign/rotom-table.sqlite`, and private archives live outside the app checkout in `/srv/rotom-table/backups`. If `ROTOM_DB_PATH` points outside the default campaign root, it must still be private operator-controlled campaign storage; include that database path and sidecars in a separate private backup step.

After the SQLite authority migration, maps, Pokémon/trainer sheets, group inventory, and shop tables load from SQLite at runtime. Keep backing up residual JSON campaign files only as explicit maintenance/export/interchange artifacts. Player profiles, encounter tables, campaign reference overrides, and other non-map/sheet/group-inventory/shop campaign material may still live as JSON. Do not treat residual map/sheet/group-inventory/shop JSON as runtime fallback state.

A consistent SQLite backup is the only resumable backup for active move-response windows because private `pending_move_resolutions` rows are not map JSON. Maintenance JSON export retains encounter effects/resources/zones/history but terminally abandons pending prompts, clears their public summaries, and writes `data/move-automation-abandoned-pending-resolutions.json` as audit evidence. Never restore a map with a pending public summary unless the matching private repository row is present.

## Backup timing and SQLite safety

Create a backup at two normal points:

1. **Before a session:** capture the known-good campaign state before players start editing sheets, moving tokens, using live-play commands, or generating encounter output.
2. **After a session:** capture the final state after setup/edit autosaves, GM edits, and command-backed live-play writes have settled.

Use one safe SQLite backup method for every archive:

- **Preferred stopped-service archive:** pause table activity, stop the service, archive the campaign root including `rotom-table.sqlite`, `rotom-table.sqlite-wal`, and `rotom-table.sqlite-shm`, then restart the service after the archive and integrity checks pass.
- **Online SQLite snapshot only when the service cannot stop:** pause table activity and use SQLite's backup API through the `sqlite3` CLI to copy the live database into a temporary private staging directory, then archive that snapshot plus the residual JSON campaign files. Do not copy only the main `.sqlite` file while writes may still be active in WAL mode.

For the stopped-service path:

```bash
sudo systemctl stop rotom-table.service
```

For the online snapshot path, adjust paths and install the SQLite CLI from the operating system if it is not already available. This produces a consistent database copy while leaving the running service's database in place:

```bash
CAMPAIGN_ROOT=/srv/rotom-table/campaign
DB_PATH=${ROTOM_DB_PATH:-${CAMPAIGN_ROOT}/rotom-table.sqlite}
SNAPSHOT_ROOT="$(sudo mktemp -d /srv/rotom-table/sqlite-backup.XXXXXX)"
sudo chown rotom-table:rotom-table "$SNAPSHOT_ROOT"
SQLITE_SNAPSHOT="${SNAPSHOT_ROOT}/$(basename "$DB_PATH")"

sudo -u rotom-table sqlite3 "$DB_PATH" ".backup '$SQLITE_SNAPSHOT'"
sudo -u rotom-table sqlite3 "$SQLITE_SNAPSHOT" 'PRAGMA integrity_check;'
```

Then include the snapshot in the private archive or copy it into a staged campaign-root copy before archiving. Clean up the temporary snapshot directory after the archive verifies. If the online snapshot command is unavailable or fails, stop the service and use the preferred stopped-service archive instead.

The SQLite migration command also creates a pre-migration backup when importing existing JSON into the database. Treat that migration backup as an extra safety checkpoint, not a replacement for the normal pre-session and post-session campaign archives in this runbook.

## Timestamped campaign archive

Run this on the private host, adjusting `SESSION_TAG` to `pre-session`, `post-session`, or another short local label. These are the normal pre-session and post-session backup commands; keep any copied output in private operator notes, not in the app repository.

```bash
CAMPAIGN_ROOT=/srv/rotom-table/campaign
BACKUP_ROOT=/srv/rotom-table/backups
SESSION_TAG=pre-session
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_ROOT}/rotom-campaign-${SESSION_TAG}-${STAMP}.tar.gz"

sudo install -d -o rotom-table -g rotom-table -m 0750 "$BACKUP_ROOT"
sudo tar -C "$(dirname "$CAMPAIGN_ROOT")" -czf "$ARCHIVE" "$(basename "$CAMPAIGN_ROOT")"
sudo chmod 0600 "$ARCHIVE"
sudo gzip -t "$ARCHIVE"
sudo tar -tzf "$ARCHIVE" | sudo tee "${ARCHIVE}.listing" >/dev/null
sudo chmod 0600 "${ARCHIVE}.listing"
sudo head "${ARCHIVE}.listing"
sudo sha256sum "$ARCHIVE" | sudo tee "${ARCHIVE}.sha256" >/dev/null
sudo chmod 0600 "${ARCHIVE}.sha256"
```

Before a game, leave `SESSION_TAG=pre-session`. After a game, rerun the same block with:

```bash
SESSION_TAG=post-session
```

For any archive intended to protect live-play state, verify that the listing includes the SQLite database and any WAL sidecars that exist, plus residual JSON campaign files:

```bash
sudo grep -E 'campaign/(rotom-table\.sqlite|rotom-table\.sqlite-wal|rotom-table\.sqlite-shm|data/maps/|data/sheets/|data/trainers/|data/group-inventories/|data/shops/|data/player-profiles/|encounter_tables/)' "${ARCHIVE}.listing"
```

If `ROTOM_DB_PATH` points outside `CAMPAIGN_ROOT`, create and verify a second private archive for that database path and its sidecars or place the safe SQLite snapshot in the campaign archive staging area before running `tar`.

Example archive name:

```text
/srv/rotom-table/backups/rotom-campaign-pre-session-20260604T193000Z.tar.gz
```

Restart the service if you stopped it:

```bash
sudo systemctl start rotom-table.service
curl -fsS http://127.0.0.1:3000/api/health
```

## Deployment and environment configuration notes

Campaign archives are not enough to rebuild a VPS. Keep a separate private record of the deployment settings used with the archive:

- `/etc/rotom-table/rotom-table.env`, including `ROTOM_CAMPAIGN_ROOT`, `NITRO_HOST`, `NITRO_PORT`, `NODE_ENV`, and whether `ROTOM_ENABLE_HOSTED_WRITES=1` was intentionally enabled;
- `/etc/systemd/system/rotom-table.service` or the reviewed service unit installed on the host;
- reverse-proxy and outer-access-gate configuration needed to reach the loopback Node service;
- the app commit or release identifier deployed in `/srv/rotom-table/app`, and the branch or tag name only when it helps identify that release.

Treat those records as private operational data. Prefer `main` plus short-lived feature branches for app-code deployment notes; do not create long-lived `dev` and `production` branch tiers unless a real staging environment exists. Branch names are not data-isolation boundaries, so a later staging host must use a different writable `ROTOM_CAMPAIGN_ROOT` from the private production table. The real environment file may contain private paths or future credentials, so keep private copies root-readable only and do not commit them to Git. If you need a shareable reference, commit only placeholder examples such as `.env.vps.example`, or write a redacted note that replaces host-specific values and credentials with placeholders.

A private config archive can be stored beside the campaign archive when the files exist on the host:

```bash
BACKUP_ROOT=/srv/rotom-table/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CONFIG_ARCHIVE="${BACKUP_ROOT}/rotom-config-${STAMP}.tar.gz"

sudo tar -czf "$CONFIG_ARCHIVE" \
  /etc/rotom-table/rotom-table.env \
  /etc/systemd/system/rotom-table.service
sudo chmod 0600 "$CONFIG_ARCHIVE"
```

Add proxy or access-gate config files only when the operator is allowed to copy them and understands whether they include credentials. Keep tunnel credentials, password files, provider exports, private hostnames, logs, and screenshots out of the app repository.

## Restore smoke check

Run a restore smoke check on a temporary campaign root before depending on a backup for a real recovery. Do not restore over the live campaign root for this check, and do not create the temporary root inside `/srv/rotom-table/app` or another tracked checkout.

Restore the campaign archive into a staging directory outside the app checkout:

```bash
ARCHIVE=/srv/rotom-table/backups/rotom-campaign-post-session-20260604T223000Z.tar.gz
RESTORE_ROOT="$(sudo mktemp -d /srv/rotom-table/restore-smoke.XXXXXX)"
sudo tar -C "$RESTORE_ROOT" -xzf "$ARCHIVE"
sudo chown -R rotom-table:rotom-table "$RESTORE_ROOT"
RESTORED_CAMPAIGN_ROOT="${RESTORE_ROOT}/campaign"

test -d "$RESTORED_CAMPAIGN_ROOT/data/maps"
test -d "$RESTORED_CAMPAIGN_ROOT/data/sheets"
test -d "$RESTORED_CAMPAIGN_ROOT/data/trainers"
test ! -d "$RESTORED_CAMPAIGN_ROOT/data/group-inventories" || test -r "$RESTORED_CAMPAIGN_ROOT/data/group-inventories"
test ! -d "$RESTORED_CAMPAIGN_ROOT/data/shops" || test -r "$RESTORED_CAMPAIGN_ROOT/data/shops"
test -d "$RESTORED_CAMPAIGN_ROOT/data/player-profiles"
test -d "$RESTORED_CAMPAIGN_ROOT/encounter_tables"
test ! -d "$RESTORED_CAMPAIGN_ROOT/data/reference-overrides" || test -f "$RESTORED_CAMPAIGN_ROOT/data/reference-overrides/pokedex.json"
test ! -f "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite" || test -r "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite"
test ! -f "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite-wal" || test -r "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite-wal"
test ! -f "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite-shm" || test -r "$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite-shm"
```

If the backup contains a restored SQLite database and the `sqlite3` CLI is available, verify the database itself before booting the temporary app:

```bash
RESTORED_DB_PATH="$RESTORED_CAMPAIGN_ROOT/rotom-table.sqlite"
test ! -f "$RESTORED_DB_PATH" || sudo -u rotom-table sqlite3 "$RESTORED_DB_PATH" 'PRAGMA integrity_check;'
```

Boot a separate loopback-only app process against that temporary campaign root. Use a different port from the real service so the live table can remain stopped or isolated while you inspect the restore. The exact hosted-write flag is included here only so the disposable test write below can prove persistence in the restored copy. If production uses a custom `ROTOM_DB_PATH` outside `ROTOM_CAMPAIGN_ROOT`, point the smoke process at the restored copy of that database instead of the live database; never run a restore smoke against the production database path.

```bash
cd /srv/rotom-table/app
NODE_ENV=production \
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3100 \
ROTOM_CAMPAIGN_ROOT="$RESTORED_CAMPAIGN_ROOT" \
ROTOM_ENABLE_HOSTED_WRITES=1 \
npm run start
```

In a browser on the host or through the same private access path, verify the restored data loads before making any changes:

- open `http://127.0.0.1:3100/login` and choose the GM role, remembering that this is still the trust-based table role picker, not public authentication;
- open `/maps` and load at least one restored map;
- open `/sheets` and load at least one restored Pokémon sheet and one trainer sheet;
- open `/group-inventory` and confirm the restored shared party inventory loads from SQLite;
- open `/players` and confirm restored player profiles and linked character references are present;
- open `/encounter-tables` and confirm restored encounter-table regions and tables are listed;
- if the campaign has Pokédex overrides, open `/pokedex` and confirm one campaign-specific entry reflects the restored override.

Then verify a temporary restore smoke write persists after restart:

1. In the temporary restore app, create or edit a clearly disposable item such as `Restore Smoke <current-date>` in a map folder, sheet folder, or group inventory row.
2. Confirm the matching map/sheet/group-inventory state loads from SQLite after a refresh; if `sqlite3` is available, inspect the restored `maps`, `sheets`, `group_inventories`, `shop_tables`, `map_folders`, or `sheet_folders` tables rather than looking for runtime JSON writes, especially when a shop export/backup is expected.
3. If the backup includes live-play state, open a disposable restored map and run a small command-backed action such as moving a smoke token or changing a smoke token's HP. Confirm the map/sheet values update in the UI and, if `sqlite3` is available, that the restored database still reports `PRAGMA integrity_check;` after the command.
4. Stop the temporary app process with `Ctrl+C` and start it again with the same environment values.
5. Reload the edited map, sheet, group inventory, player profile list, encounter table, and any command-backed smoke map to confirm the disposable write and live-play state are still present.
6. Delete the disposable item from the temporary root, or discard the entire temporary restore root after recording the result.

After the check, clean up only the staging directory created for this smoke pass:

```bash
case "$RESTORE_ROOT" in
  /srv/rotom-table/restore-smoke.*) sudo rm -rf "$RESTORE_ROOT" ;;
  *) echo "Refusing to remove unexpected path: $RESTORE_ROOT" >&2 ;;
esac
```

If the app cannot boot with the temporary `ROTOM_CAMPAIGN_ROOT`, any expected folder is missing, restored maps/sheets/trainers/group inventory/player profiles/reference overrides/encounter tables do not load, restored shop tables are absent from SQLite when expected, or the test write disappears after restart, treat the archive as unverified and create a new backup before the next session.

## Rollback after a bad deploy

Use a rollback when a deploy corrupts live-play state, points the app at the wrong campaign root, fails the deployment or live-play smoke checklist, or otherwise must be abandoned before a session. Prefer restoring the most recent verified pre-session archive when the bad deploy happened before play, or the most recent verified post-session archive when recovering the final state after play.

1. Tell players to stop using the table and keep the private URL closed until the rollback smoke passes.
2. Stop the service before touching either app code or campaign data:

   ```bash
   sudo systemctl stop rotom-table.service
   ```

3. Preserve the failed campaign directory for short-term investigation instead of deleting it in place:

   ```bash
   CAMPAIGN_ROOT=/srv/rotom-table/campaign
   FAILED_ROOT="/srv/rotom-table/campaign.failed-$(date -u +%Y%m%dT%H%M%SZ)"
   sudo mv "$CAMPAIGN_ROOT" "$FAILED_ROOT"
   ```

4. Restore the chosen campaign archive into the expected private campaign location:

   ```bash
   ARCHIVE=/srv/rotom-table/backups/rotom-campaign-pre-session-20260604T193000Z.tar.gz
   sudo tar -C /srv/rotom-table -xzf "$ARCHIVE"
   sudo chown -R rotom-table:rotom-table /srv/rotom-table/campaign
   if sudo test -f /srv/rotom-table/campaign/rotom-table.sqlite; then
     sudo -u rotom-table sqlite3 /srv/rotom-table/campaign/rotom-table.sqlite 'PRAGMA integrity_check;'
   fi
   ```

   If production uses a custom `ROTOM_DB_PATH` outside the campaign root, restore that database backup or safe SQLite snapshot to the configured private database path before starting the service. Make sure the restored app environment points to the restored database, not to the failed live database.

5. Return the app checkout to the intended known-good release or commit, rebuild if your deployment process requires it, and restore any private environment/systemd configuration that changed during the failed deploy:

   ```bash
   cd /srv/rotom-table/app
   git fetch --tags
   git checkout <known-good-commit-or-tag>
   npm ci
   npm run build
   sudo systemctl daemon-reload
   ```

6. Start the service and run health, deployment smoke, and live-play smoke checks before inviting players back:

   ```bash
   sudo systemctl start rotom-table.service
   curl -fsS http://127.0.0.1:3000/api/health
   ```

7. After rollback verification passes, create a fresh `SESSION_TAG=post-rollback` archive so the restored baseline is easy to find. Keep the failed campaign directory only as long as needed for private investigation, then remove it with the same path caution used for restore smoke directories.

Do not commit rollback archives, failed campaign copies, SQLite databases, WAL sidecars, private config files, logs, or copied player data to the app repository.

## Retention guidance

Keep enough history to recover from both accidental edits and delayed discoveries:

- keep the latest pre-session backup until the matching post-session backup has been checked;
- keep several recent post-session archives for ordinary rollback;
- keep weekly or monthly archives for longer campaigns when storage allows;
- keep at least one private off-host copy, such as encrypted external storage or an operator-controlled private backup location;
- prune only after confirming newer archives list successfully and are stored outside the app checkout.

Rotom Table archives can contain private maps, player details, unreleased story material, and future secrets copied from configuration. Use filesystem permissions and private storage appropriate for your table.

## Git hygiene

Do not create backup archives under `/srv/rotom-table/app`, `docs/`, or any other tracked repository path. Do not run `git add` on `.tar`, `.tar.gz`, `.tgz`, `.zip`, copied `.env` files, campaign JSON, campaign reference overrides, or generated restore staging directories.

Before committing product changes, run this from the app checkout and confirm that no backup archives or private campaign files are staged:

```bash
cd /srv/rotom-table/app
git status --short
```

If an archive was created in the checkout by mistake, move it to `/srv/rotom-table/backups` or another private backup location before committing anything.

## Related docs

- [Private VPS hosting scope](private-vps-hosting.md)
- [Campaign repositories](campaign-repositories.md)
- [Security](../SECURITY.md)
