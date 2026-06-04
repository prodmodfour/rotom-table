# Private VPS backup runbook

Use this runbook to create private backups of a trusted-table VPS campaign before and after play sessions, then smoke-check a restore before trusting an archive. It covers campaign JSON stored under `ROTOM_CAMPAIGN_ROOT` and the private deployment settings needed to recreate the host. It does not make Rotom Table a public hosted service, and it does not encrypt archives for you.

## What to back up

Back up the entire configured campaign root, not only the file you edited most recently:

- `data/maps/`
- `data/sheets/`
- `data/trainers/`
- `data/player-profiles/`
- `encounter_tables/`
- any private campaign assets or notes intentionally kept under the campaign root

For the documented VPS layout, the app runs from `/srv/rotom-table/app`, campaign data lives in `/srv/rotom-table/campaign`, and private archives live outside the app checkout in `/srv/rotom-table/backups`.

## Backup timing

Create a backup at two normal points:

1. **Before a session:** capture the known-good campaign state before players start editing sheets, moving tokens, or generating encounter output.
2. **After a session:** capture the final state after autosaves and GM edits have settled.

For the safest copy, pause table activity and stop the service while taking the archive:

```bash
sudo systemctl stop rotom-table.service
```

If you cannot stop the service, ask everyone to pause changes, wait for autosaves to finish, then archive immediately. Avoid copying while a large map, sheet, profile, or encounter-table write is in progress.

## Timestamped campaign archive

Run this on the private host, adjusting `SESSION_TAG` to `pre-session`, `post-session`, or another short local label.

```bash
CAMPAIGN_ROOT=/srv/rotom-table/campaign
BACKUP_ROOT=/srv/rotom-table/backups
SESSION_TAG=pre-session
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_ROOT}/rotom-campaign-${SESSION_TAG}-${STAMP}.tar.gz"

sudo install -d -o rotom-table -g rotom-table -m 0750 "$BACKUP_ROOT"
sudo tar -C "$(dirname "$CAMPAIGN_ROOT")" -czf "$ARCHIVE" "$(basename "$CAMPAIGN_ROOT")"
sudo chmod 0600 "$ARCHIVE"
sudo tar -tzf "$ARCHIVE" | head
```

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
- the app commit or release identifier deployed in `/srv/rotom-table/app`.

Treat those records as private operational data. The real environment file may contain private paths or future credentials, so keep private copies root-readable only and do not commit them to Git. If you need a shareable reference, commit only placeholder examples such as `.env.vps.example`, or write a redacted note that replaces host-specific values and credentials with placeholders.

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
test -d "$RESTORED_CAMPAIGN_ROOT/data/player-profiles"
test -d "$RESTORED_CAMPAIGN_ROOT/encounter_tables"
```

Boot a separate loopback-only app process against that temporary campaign root. Use a different port from the real service so the live table can remain stopped or isolated while you inspect the restore. The exact hosted-write flag is included here only so the disposable test write below can prove persistence in the restored copy.

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
- open `/players` and confirm restored player profiles and linked character references are present;
- open `/encounter-tables` and confirm restored encounter-table regions and tables are listed.

Then verify a test write persists after restart:

1. In the temporary restore app, create or edit a clearly disposable item such as `Restore Smoke <current-date>` in a map folder or sheet folder.
2. Confirm the matching JSON file exists under the temporary root, for example with `find "$RESTORED_CAMPAIGN_ROOT" -iname '*restore-smoke*' -print`.
3. Stop the temporary app process with `Ctrl+C` and start it again with the same environment values.
4. Reload the edited map, sheet, player profile list, or encounter table and confirm the disposable write is still present.
5. Delete the disposable item from the temporary root, or discard the entire temporary restore root after recording the result.

After the check, clean up only the staging directory created for this smoke pass:

```bash
case "$RESTORE_ROOT" in
  /srv/rotom-table/restore-smoke.*) sudo rm -rf "$RESTORE_ROOT" ;;
  *) echo "Refusing to remove unexpected path: $RESTORE_ROOT" >&2 ;;
esac
```

If the app cannot boot with the temporary `ROTOM_CAMPAIGN_ROOT`, any expected folder is missing, restored maps/sheets/trainers/player profiles/encounter tables do not load, or the test write disappears after restart, treat the archive as unverified and create a new backup before the next session.

## Retention guidance

Keep enough history to recover from both accidental edits and delayed discoveries:

- keep the latest pre-session backup until the matching post-session backup has been checked;
- keep several recent post-session archives for ordinary rollback;
- keep weekly or monthly archives for longer campaigns when storage allows;
- keep at least one private off-host copy, such as encrypted external storage or an operator-controlled private backup location;
- prune only after confirming newer archives list successfully and are stored outside the app checkout.

Rotom Table archives can contain private maps, player details, unreleased story material, and future secrets copied from configuration. Use filesystem permissions and private storage appropriate for your table.

## Git hygiene

Do not create backup archives under `/srv/rotom-table/app`, `docs/`, or any other tracked repository path. Do not run `git add` on `.tar`, `.tar.gz`, `.tgz`, `.zip`, copied `.env` files, campaign JSON, or generated restore staging directories.

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
