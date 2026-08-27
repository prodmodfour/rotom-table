# Local production-like Ranger workspace tools

These scripts create and operate a local-only workspace around a Rotom Table checkout that mirrors the private Ranger VPS layout closely enough for safe smoke testing.

When this repository is checked out as `rotom-table-dev/app`, the scripts use the parent folder (`rotom-table-dev/`) as the workspace root and create:

```text
campaigns/ranger/
backups/ranger/
env/ranger.prodlike.env
env/ranger.dev.env
logs/
run/
.npm/
```

Override the workspace root with `ROTOM_WORKSPACE_ROOT=/path/to/workspace` if needed. Campaign data, logs, backups, caches, and runtime files stay outside the app checkout by default and must not be committed.

## Modes

- `bin/start-prodlike.sh` is the closer production mimic. It loads `env/ranger.prodlike.env`, uses `NODE_ENV=production`, binds Nitro to `127.0.0.1:3000`, and starts the built app with `npm run start` after a build.
- `bin/start-dev.sh` is normal Nuxt development mode. It loads `env/ranger.dev.env` and runs `npm run dev`.

Local prodlike mode intentionally uses NODE_ENV=production and npm run start after build.

## First-time setup

From this directory or anywhere in the checkout, run:

`deploy/local-prodlike/bin/setup.sh`

Then validate and start:

`deploy/local-prodlike/bin/validate.sh`

The default validation is deployment-focused (template check, typecheck, and build). The complete repository test suite is release/contributor evidence rather than a production-host prerequisite; run it only when needed with `ROTOM_RUN_FULL_TESTS=1 deploy/local-prodlike/bin/validate.sh`.

`deploy/local-prodlike/bin/start-prodlike.sh`

`deploy/local-prodlike/bin/health-prodlike.sh`

The local production-like URL is:

`http://127.0.0.1:3000`

If `start-prodlike.sh` says port 3000 is already in use, identify the local process with `ss -ltnp | grep ':3000'` and stop that local server before retrying. The stop script only stops the PID recorded in this workspace's `run/rotom-table-prodlike.pid` and will not kill unrelated Node processes.

## Ranger sheet sync helpers

Pull only production sheets into the local workspace:

`deploy/local-prodlike/bin/pull-prod-sheets.sh`

Dry-run a sheet push to production:

`deploy/local-prodlike/bin/push-sheets-to-prod.sh`

Actually push local sheets to production after a remote backup is created:

`deploy/local-prodlike/bin/push-sheets-to-prod.sh --apply`

Only allow production deletes when you explicitly pass both flags:

`deploy/local-prodlike/bin/push-sheets-to-prod.sh --apply --delete`

The production sync helpers default to the Ranger VPS paths. You can override them without editing scripts:

`ROTOM_PROD_SSH=root@142.93.40.213 ROTOM_PROD_CAMPAIGN_ROOT=/srv/rotom-table/campaigns/ranger ROTOM_PROD_BACKUP_DIR=/srv/rotom-table/backups/ranger deploy/local-prodlike/bin/push-sheets-to-prod.sh`

SSH access must already work. No SSH keys, Caddy passwords, Cloudflare tokens, DigitalOcean tokens, or other secrets belong in this repository.

## Backups and full-campaign preview

Back up local Ranger data:

`deploy/local-prodlike/bin/backup-local-ranger.sh`

Preview a full campaign pull without applying changes:

`deploy/local-prodlike/bin/pull-prod-campaign-dry-run.sh`

Stop the local production-like server:

`deploy/local-prodlike/bin/stop-prodlike.sh`

## Optional local Caddy mimic

See `caddy/Caddyfile.local.example` for a loopback-only Basic Auth reverse proxy on `127.0.0.1:8080`. It contains a placeholder hash only. Generate a local hash with `caddy hash-password` and do not commit real shared or production passwords.

## Safety reminders

- Do not edit production directly unless you have a fresh backup.
- Do not commit campaign data.
- Pulling data from production is allowed; pushing is dry-run by default.
- `rsync --delete` is never used against production unless `--apply --delete` is explicitly passed.
- Keep local prodlike services bound to `127.0.0.1`; do not expose them publicly.
