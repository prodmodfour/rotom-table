# Rotom Table 1.0 campaign upgrade guide

This is the supported upgrade procedure for the 1.0 private Linux x86-64 VPS shape. Work on a copied or stopped-service campaign only. Never test an upgrade against the sole live campaign database.

## Supported inputs

Rotom Table 1.0 accepts exactly three input families:

1. a fresh or empty private `ROTOM_CAMPAIGN_ROOT`;
2. an app-produced SQLite database whose `PRAGMA user_version` is 1 through 56;
3. a documented JSON-era campaign root imported with `npm run migrate:sqlite`.

Unknown, schema-zero non-empty, partial, corrupt, non-database, future-version, read-only, locked, or active-WAL inputs are rejected before the campaign database is replaced. The complete machine index is `data/release-readiness/supported-upgrade-inputs.v1.json`.

## Before any upgrade

1. Record the deployed Rotom Table version from `/api/health` or **Settings → About Rotom Table**.
2. Tell players to stop using the table and stop the service:

   ```bash
   sudo systemctl stop rotom-table.service
   ```

3. Confirm the database has no `-wal` or `-shm` sidecar. If either remains, do not delete it blindly. Start the old known-good build against a private copy, let SQLite checkpoint and close cleanly, stop it, and retry on that copy.
4. Create and verify a private campaign backup according to [the 1.0 backup runbook](../private-vps-backups.md).
5. Run the command as the same private service account that owns the campaign files.

## App-produced SQLite v1-v56

```bash
cd /srv/rotom-table/app
npm ci --include=dev
npm run upgrade:campaign -- \
  --database /srv/rotom-table/campaign/rotom-table.sqlite \
  --backup /srv/rotom-table/backups/pre-1.0-rotom-table.sqlite
```

The command verifies the SQLite header, supported version, exact app schema, integrity, foreign keys, write permissions, sidecars, and exclusive access before creating a byte-exact backup. It upgrades a staging copy through each contiguous migration, audits the result, fsyncs it, and atomically replaces the original path. An interruption leaves the original byte-exact or the complete upgraded database; rerunning with the same matching backup converges safely. A v56 input is audited and reported as already current without a migration write.

Verify afterward:

```bash
sqlite3 /srv/rotom-table/campaign/rotom-table.sqlite \
  'PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

Expected: schema `56`, `ok`, and no foreign-key rows.

## JSON-era campaign root

The source root must be private, outside the app checkout, and contain the documented `data/maps`, sheet/trainer, inventory, profile, and optional campaign JSON trees. Run:

```bash
cd /srv/rotom-table/app
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign \
npm run migrate:sqlite -- --backup-root /srv/rotom-table/backups
```

The command creates a pre-import backup, validates every discovered JSON document, imports into a staging database, advances it to schema v56, applies current ordinary-sheet compatibility migration, runs integrity and foreign-key checks, and atomically installs `rotom-table.sqlite`. Source JSON remains unchanged. A malformed root or interrupted migration leaves no partial target database. A rerun against a stopped, integrity-clean app database is atomic and skips byte-identical imported authority.

Do not invoke `scripts/migrate-campaign-to-sqlite.mjs` directly; it is the preserved legacy parsing module underneath the release wrapper, not the operator command.

## Restore, start, and verify

After the command passes:

```bash
sudo chown rotom-table:rotom-table /srv/rotom-table/campaign/rotom-table.sqlite
sudo systemctl start rotom-table.service
curl -fsS http://127.0.0.1:3000/api/health
```

Confirm the response reports the expected Rotom Table version and storage schema 56. Then follow the deployment and liveplay smoke checklists before reopening the table.

## Rollback boundary

**Database downgrade is unsupported; rollback means restoring the exact pre-upgrade backup.**

Stop the service, preserve the failed upgraded database for private investigation, restore the byte-exact backup to the configured database path, restore the matching old app version, and run integrity plus liveplay smoke checks. Never lower `PRAGMA user_version`, run reverse SQL, or copy rows by hand.

## Rejection and recovery

| Rejection | Meaning | Recovery |
| --- | --- | --- |
| `input-not-sqlite` / `input-corrupt` | Header, open, integrity, or foreign keys failed. | Preserve the file; restore a verified backup. |
| `input-partial` | The claimed version does not have the exact app-produced schema. | Restore the matching app backup; do not synthesize missing tables. |
| `input-unsupported-version` | Schema is zero, unknown, or newer than this build. | Use JSON import only for a documented JSON root; otherwise use the matching/newer app build. |
| `input-sidecars-present` | The database may have uncheckpointed WAL authority. | Stop/checkpoint with the old build on a copy; never discard sidecars blindly. |
| `input-locked` | Another process or connection owns the database. | Stop the service and all database tools, then retry. |
| `input-read-only` | Atomic staging/replacement cannot be guaranteed. | Correct private service-account ownership and directory permissions. |
| `backup-exists` | The requested backup path contains different bytes. | Choose another path or verify and preserve the existing archive. |
| `upgrade-failed` | A staged migration/audit failed. | Original remains intact; preserve evidence, repair through the owning migration authority, then retry. |

No rejection requires direct SQLite or JSON surgery.
