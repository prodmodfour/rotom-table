# Private VPS hosting scope

Rotom Table's first VPS target is **private trusted-table hosting**: one GM/operator-controlled Node/Nitro process for a known campaign group. It runs the SQLite-authoritative campaign workflow, with remaining profile/override/maintenance JSON, in private operator-controlled storage; it does not turn Rotom Table into a public website or managed service.

## Safe first use

Use this mode only when all of these are true:

- the VPS is operated by the GM or another trusted table operator;
- access to the app is restricted by an outer gate such as a private network, VPN/Tailscale, reverse-proxy authentication, Cloudflare Access, SSH tunnel, or equivalent provider controls; see [Outer access gate](#outer-access-gate) before sharing the URL;
- participants are known table members who already trust the GM/operator and campaign data;
- the campaign database and remaining campaign-owned JSON/reference override diffs stay in private operator-controlled storage, preferably through `ROTOM_CAMPAIGN_ROOT` as described in [Campaign repositories](campaign-repositories.md);
- the operator understands the SQLite and residual-file authority boundaries in [Local development](local-development.md) and the security expectations in [Security](../SECURITY.md).

The built Nitro server can be used for private host smoke checks with Node.js 24 LTS, `npm run build`, `npm run start`, and the no-secret `/api/health` endpoint. `/api/health` is only a process health check; it does not prove that live-play SSE, command routes, revisions, conflict handling, or persistence are ready. After every deploy, follow the [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md), then run the [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md) before sharing the private URL with players for a session. Keep normal profile-based play intact: the GM manages profiles from `/players`, players choose **Player Login**, and players open the regular player-visible routes such as `/maps/<slug>`.

## Environment example

Use the placeholder-only [`.env.vps.example`](../.env.vps.example) as a starting point for a private host's service manager environment or for an untracked `.env` file loaded by the deployment. It sets `NODE_ENV=production`, loopback Nitro bind settings, and an example `ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign` so campaign-owned JSON and reference override diffs stay outside the application checkout. Replace paths and bind settings for your host, but keep real `.env` files, hostnames, credentials, and campaign data out of Git.

## Branch and data separation strategy

If a private VPS deployment process names a Git branch, keep the branch model simple: prefer `main` as the deployable production-code line plus short-lived feature branches for review. Avoid maintaining long-lived `dev` and `production` branches unless there is a real staging environment with its own service, access gate, backups, and isolated campaign data.

Data separation matters more than branch names. The app checkout and `ROTOM_CAMPAIGN_ROOT` are separate operational boundaries; branch naming must not decide which campaign JSON or reference override diff is writable. If a staging environment is added later, never point staging and production at the same writable `ROTOM_CAMPAIGN_ROOT`, and record the app commit, tag, or release identifier deployed with each private campaign backup.

## Primary process management path

The primary private VPS process-management path is **systemd with a direct Node.js 24 runtime**. The service runs the built Nitro server from the app checkout, while SQLite authority and remaining campaign-owned JSON/reference override diffs stay in `/srv/rotom-table/campaign` through `ROTOM_CAMPAIGN_ROOT`.

Install Node 24 and npm **system-wide** so both the deployment shell and the unprivileged `rotom-table` service account can find them through `/usr/local/bin`, `/usr/bin`, or `/bin`. An operator-only `nvm` installation is not sufficient for the example unit's service account. A source checkout also needs Git; Python 3 is needed only for the optional complete source-test pass, not for the built server at runtime. Install Git plus the basic HTTPS/health tools before cloning. For the certified Debian 12 shape (and Debian-derived hosts), the exact prerequisite step is:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends git ca-certificates curl
```

Equivalent packages are acceptable on another supported Linux x86-64 host. Install Node 24 system-wide through the operator's reviewed distribution method, then verify every source-install prerequisite before cloning or building:

```bash
git --version
node --version # must be v24.x
npm --version
curl --version
```

A manual smoke for the same command that systemd should supervise is:

```bash
cd /srv/rotom-table/app
git status --short # must be empty for a release build
npm ci --include=dev
npm run build
NODE_ENV=production \
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3000 \
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign \
npm run start
```

No `ROTOM_DB_PATH` value is required for the standard VPS layout because the SQLite database defaults to `/srv/rotom-table/campaign/rotom-table.sqlite`. Set `ROTOM_DB_PATH` in the same process environment only if the database should live at another private operator-controlled campaign-storage path outside the app checkout and covered by the same backup practice.

Then confirm the built server is reachable only through the intended private path:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

For unattended VPS operation, use the example unit at [`deploy/systemd/rotom-table.service`](../deploy/systemd/rotom-table.service) as a reviewable starting point and install the reviewed copy as `/etc/systemd/system/rotom-table.service`. The example runs as a non-root `rotom-table` user/group, sets `WorkingDirectory=/srv/rotom-table/app`, loads app settings from `EnvironmentFile=/etc/rotom-table/rotom-table.env`, starts the built server with `npm run start`, and defines `Restart=on-failure` with a short `RestartSec` delay. If an operator does not want the npm wrapper, the equivalent command is `node .output/server/index.mjs` from the same working directory.

The real systemd environment file should live outside the app checkout, for example at `/etc/rotom-table/rotom-table.env`, and should be copied from `.env.vps.example` or written with the same key names and host-specific values. Keep it untracked and root-readable only, for example `0600`, because it may contain private paths or future secrets. It should set the selected private host values such as `NODE_ENV=production`, `NITRO_HOST=127.0.0.1`, `NITRO_PORT=3000`, `ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign`, optional `ROTOM_DB_PATH` only when the SQLite database should not use the campaign-root default, and the optional exact hosted-write opt-in only when the private host is ready for campaign writes. The example unit makes only `/srv/rotom-table/campaign` writable with `ProtectSystem=strict`; if either storage variable points elsewhere, add the exact private path to the reviewed unit's `ReadWritePaths` before starting it. Keep the database path in private operator-controlled campaign storage, not in the app checkout, and include the database plus WAL sidecars in backup/restore practice.

A minimal install flow after creating `/srv/rotom-table/app` and building the app is:

```bash
getent group rotom-table >/dev/null 2>&1 || sudo groupadd --system rotom-table
id -u rotom-table >/dev/null 2>&1 || sudo useradd --system --gid rotom-table --home-dir /srv/rotom-table --shell /usr/sbin/nologin rotom-table
sudo install -d -o rotom-table -g rotom-table -m 0750 /srv/rotom-table/campaign /srv/rotom-table/backups
sudo install -d -o root -g root -m 0750 /etc/rotom-table
sudo install -o root -g root -m 0600 .env.vps.example /etc/rotom-table/rotom-table.env
sudo editor /etc/rotom-table/rotom-table.env
sudo install -o root -g root -m 0644 deploy/systemd/rotom-table.service /etc/systemd/system/rotom-table.service
sudo -u rotom-table /usr/bin/env node --version
sudo -u rotom-table /usr/bin/env npm --version
sudo -u rotom-table test -r /srv/rotom-table/app/.output/server/index.mjs
sudo -u rotom-table test -w /srv/rotom-table/campaign
sudo systemctl daemon-reload
sudo systemctl enable --now rotom-table.service
```

The four service-account checks must succeed before enabling the service. For an existing host, first make a release-boundary backup, stop the service, update the checkout to the reviewed immutable revision, run `npm ci --include=dev` and `npm run build`, then start the service and complete both smoke checklists. Do not overwrite `.output/` while a session or the old Node process is active. Standard output and error go to journald, available with `journalctl -u rotom-table.service` or `journalctl -u rotom-table.service -f`.

Docker and Compose are not the primary deployment path for the initial private VPS target. Keep the Node service bound to loopback until a reverse proxy and outer access gate are configured.

## Reverse proxy example

Use one private reverse proxy in front of the loopback-only Node service. The primary example below uses Caddy because it can terminate HTTPS and proxy WebSocket upgrades without extra upgrade-header wiring. Replace `rotom-table.example.com` with the private DNS name for the host, and do not make that name reachable by arbitrary internet users unless a separate outer access gate is already in place.

```caddyfile
# /etc/caddy/Caddyfile
rotom-table.example.com {
  encode zstd gzip

  # Caddy terminates HTTPS here and forwards plain HTTP only to the
  # loopback Nitro server supervised by systemd.
  reverse_proxy 127.0.0.1:3000
}
```

The matching Nitro environment should keep the app on loopback:

```bash
NITRO_HOST=127.0.0.1
NITRO_PORT=3000
```

After reloading the proxy, verify both the direct loopback health check and the proxied HTTPS health check:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://rotom-table.example.com/api/health
```

Those health checks are not live-play readiness checks. Live profile play also needs the long-lived `GET /api/events` SSE stream to stay open, plus normal HTTP POST command routes under `/api/maps/*` to reach the same Node process without proxy caching or buffering. The SSE endpoint sends heartbeat comments so common reverse proxies and Cloudflare do not treat an otherwise quiet table as idle, and browsers treat reconnect as a possible missed-event gap that triggers revision reconciliation. In browser developer tools, `/api/events` should remain pending as `text/event-stream`; it should not be served from cache, buffered until the response ends, or challenged after the page has already loaded.

WebSocket upgrade support must work end-to-end for legacy `/sessions` maintenance surfaces such as `WebSocket /api/sessions/socket` and for any future realtime endpoints. Caddy's `reverse_proxy` handles SSE streaming and WebSocket upgrades by default; if you replace this example with nginx or another proxy, explicitly configure HTTP/1.1 upgrade forwarding, disable response buffering for `/api/events`, avoid caching `/maps/*` and `/api/maps/*`, and test the socket path before sharing the host with players.

The reverse proxy is only transport and TLS plumbing. It is not Rotom Table authentication, not the GM/Player role picker, and not a public-hosting safety layer by itself. Keep the Node service unexposed on `127.0.0.1`, restrict the HTTPS URL with the required outer access gate for the trusted table, and keep real hostnames, credentials, certificates, access-policy exports, and proxy logs out of Git.

## Outer access gate

A private VPS URL must not be reachable by arbitrary internet users. Put an outer access gate in front of the Rotom Table origin before sharing the URL with players, and verify that the gate protects the app before the `/login` page, `/api/events`, `/api/health`, other `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths.

Acceptable gate examples include the following. Choose the one that fits the host and table; no single vendor is required.

- A private network or firewall rule that only allows trusted LAN/private-subnet clients and blocks direct public access.
- A VPN or mesh network such as Tailscale or WireGuard where only known table devices can reach the hostname.
- Cloudflare Access or an equivalent identity-aware proxy that allows only the trusted campaign group.
- Reverse-proxy basic authentication for a trusted group, served only over HTTPS, with strong shared credentials kept outside Git and rotated if they are shared too broadly.
- An SSH tunnel or comparable provider control that keeps the app reachable only from explicitly approved operator/player devices.

The outer gate is separate from Rotom Table's GM/Player role picker. **GM Login is not enough** for a private VPS: it is a table workflow role choice after a visitor has reached the app, not a password, account system, or public authentication layer. Anyone who can reach the app may be able to choose a local role, so the gate should admit only known table members who already trust the GM/operator.

If Cloudflare Access or a similar identity-aware proxy is used, apply the policy to the whole app origin or to path rules that include page loads, `/api/events`, `/api/health`, all `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrade paths. Protecting only `/login`, `/maps/*`, or the HTML page loads is not enough because live-play commands and realtime reconciliation happen through API requests after the page loads.

Before sharing a host URL, confirm these checks:

- the Nitro process still binds to `127.0.0.1`, and the VPS firewall blocks direct public access to the Node port such as `:3000`;
- an off-network or unauthenticated browser cannot load `/login`, `/api/health`, `/api/events`, or a mutating `/api/maps/*` command route;
- the same outer gate covers normal page loads, `/api/events`, `/api/health`, all other `/api/*` routes, mutating `/api/maps/*` command routes, and WebSocket upgrades;
- access-gate configs, basic-auth password files, tunnel credentials, private hostnames, provider policy exports, and logs stay out of Git.

## VPS campaign data layout

A simple private VPS can keep the app, campaign data, and backups under one operator-controlled parent while still separating the public/shareable app checkout from private campaign JSON and reference override diffs:

```text
/srv/rotom-table/
  app/                    # application checkout and built .output/ server
  campaign/               # ROTOM_CAMPAIGN_ROOT; private campaign JSON, database, and reference override diffs
    rotom-table.sqlite     # default SQLite database path as live-play repositories migrate
    data/
      maps/
      sheets/
      trainers/
      group-inventories/  # optional explicit export/interchange output
      shops/              # optional explicit shop export/interchange output
      player-profiles/
      reference-overrides/
    encounter_tables/
  backups/                # private backup archives or restore staging, not Git
```

With that layout, run the built app from `/srv/rotom-table/app` and set:

```bash
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign
```

Rotom Table then resolves campaign-owned paths under the campaign root: maps at `/srv/rotom-table/campaign/data/maps/`, Pokémon sheets at `/srv/rotom-table/campaign/data/sheets/`, trainer sheets at `/srv/rotom-table/campaign/data/trainers/`, player profiles at `/srv/rotom-table/campaign/data/player-profiles/`, campaign reference override diffs at `/srv/rotom-table/campaign/data/reference-overrides/`, and encounter tables at `/srv/rotom-table/campaign/encounter_tables/`. Shared group inventory and shop tables live in the SQLite database at runtime and appear under `/srv/rotom-table/campaign/data/group-inventories/` and `/srv/rotom-table/campaign/data/shops/` only when exported for maintenance/interchange. The SQLite live-play database defaults to `/srv/rotom-table/campaign/rotom-table.sqlite`; leave it there unless an operator deliberately chooses another private campaign-storage path and updates backups to include that database plus `-wal`/`-shm` sidecars. App-owned reference data such as `data/reference/` remains in the application checkout; GM Pokédex maintenance writes `data/reference-overrides/pokedex.json` under `ROTOM_CAMPAIGN_ROOT` instead of rewriting app-owned reference JSON.

Do not store private maps, sheets, trainers, group inventory exports, shop exports, player profiles, campaign-specific reference overrides, encounter tables, backups, or unreleased campaign notes in a public or shared app repository checkout. Keep `/srv/rotom-table/campaign` and `/srv/rotom-table/backups` private to the operator and exclude real `.env` files and generated archives from Git.

For step-by-step private archives before and after a session, plus a temporary restore smoke check, use the [Private VPS backup runbook](private-vps-backups.md).

## Migrating JSON campaign data to SQLite

Before relying on database-backed live play for an existing private campaign, stop the service or pause table activity, make sure the campaign root is external to the app checkout, then run the repeatable migration command from the app directory:

```bash
cd /srv/rotom-table/app
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign \
  npm run migrate:sqlite -- --backup-root /srv/rotom-table/backups
```

If `ROTOM_DB_PATH` is unset, the command writes `/srv/rotom-table/campaign/rotom-table.sqlite`. Set `ROTOM_DB_PATH` only when the database should live at another private operator-controlled campaign-storage path that is outside the app checkout and included in backups. The migration refuses to run without an explicit existing `ROTOM_CAMPAIGN_ROOT`, refuses campaign/database/backup paths inside the app checkout, creates a pre-migration backup under the selected backup root, leaves the source JSON files in place, and imports map JSON, Pokémon sheet JSON, and trainer sheet JSON into SQLite. Current persistent player profiles remain JSON-backed; the command validates those profile files and includes them in the backup instead of deleting or moving them.

The command logs the database path, backup path, maps imported, sheets imported, skipped unchanged rows, validated player profiles, SQLite load-validation counts, and errors. It is safe to rerun after JSON setup/edit changes: unchanged map and sheet rows are skipped, changed rows are updated, and a fresh pre-migration backup is created each run. Keep migration backups, SQLite files, WAL sidecars, real environment files, and campaign JSON out of Git.

After migration, restart the service with the same `ROTOM_CAMPAIGN_ROOT` and `ROTOM_DB_PATH` values and run the [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md) before inviting players.

## Hosted write policy

Private VPS campaign writes must fail closed in production unless the operator explicitly opts in. The selected flag is `ROTOM_ENABLE_HOSTED_WRITES`, enforced by server-side write policy on map, sheet, shop, group-inventory, encounter-table, persistent encounter-generation, player-profile, Pokédex maintenance, campaign next-day, and SQLite-backed live-play command routes that have been moved off the older production-only block.

- **Disabled by default:** when `NODE_ENV=production`, hosted writes are disabled if the flag is unset or set to anything other than exactly `1`. Values such as `true`, `yes`, `on`, or `enabled` do not enable writes. Routes covered by the hosted-write policy reject with a clear 403-style message before writing JSON or SQLite state.
- **Enabled for private hosts:** `NODE_ENV=production` plus `ROTOM_ENABLE_HOSTED_WRITES=1` opts the private instance into covered campaign writes for trusted table use, including database-backed live-play command persistence. Use this only with an outer access gate and operator-controlled campaign storage such as `ROTOM_CAMPAIGN_ROOT`; covered Pokédex maintenance writes are stored as campaign reference override diffs, not as app-checkout reference edits.
- **Development remains unchanged:** non-production local development writes keep working without the hosted-write flag, so `npm run dev` and existing local campaign workflows are not gated by VPS settings.
- **Scope:** the flag controls server-side campaign persistence, including filesystem JSON/override writes and SQLite-backed live-play map, sheet, shop, group-inventory, and operation-result writes. It is not authentication, authorization, a public-hosting safety layer, a migration trigger, or a substitute for backups and route review. Migrations/imports still require explicit operator action such as `npm run migrate:sqlite`. See the [API route mutation audit](api-route-mutation-audit.md) for the current route-by-route coverage, including map routes. GM map and shop library writes still require GM role, and player map/token writes still require player-visible maps plus selected-profile token control; group inventory player transfers still require selected-profile trainer links.

## What this is not

Private VPS hosting is not any of the following:

- public anonymous signup;
- public SaaS or multi-tenant hosting;
- a hardened public authentication system;
- a promise that every mutating route is safe for arbitrary internet users;
- a replacement for a hosted database, account system, rate limiting, abuse monitoring, content-rights review, or incident-response program.

The **GM / Player** picker and persistent player profiles are table workflow controls, not public authentication. Anyone who can reach the app may be able to choose a local role unless an outer access gate blocks them first.

## Out of scope for the initial target

Before treating a hosted instance as a regular remote table, document and verify the remaining operational pieces for that host: environment variable values, production write policy enforcement, route mutation review, process management, reverse proxy behaviour, access-gate configuration, backup practice, restores, and deployment smoke checks.

Until those pieces are verified for the specific host, keep hosted use private, conservative, and reversible. If the trust boundary is unclear, run Rotom Table locally instead.

## Related docs

- [Security](../SECURITY.md) — trust-based security expectations and public-exposure non-goals.
- [Local development](local-development.md) — filesystem-backed behaviour, checks, and production write limitations.
- [Campaign repositories](campaign-repositories.md) — using `ROTOM_CAMPAIGN_ROOT` to keep private campaign JSON and campaign reference override diffs separate from the app checkout.
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) — after-deploy install, validation, start, health, outer-gated profile play, persistence, Git hygiene, and legacy `/sessions` boundary checks.
- [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md) — multi-browser command/revision, `/api/events` SSE reconnect, conflict, refresh, and restart checks before table play.
- [Private VPS backup runbook](private-vps-backups.md) — creating private campaign and deployment-config backups before and after sessions, then smoke-checking a temporary restore without committing archives.
- [API route mutation audit](api-route-mutation-audit.md) — current non-GET route classifications, hosted-write coverage, and remaining limitations.
- [Player profiles and linked character control](player-profiles.md) — normal GM/player profile flow for table play.
- [Live session security boundaries](archive/live-session/live-session-security-boundaries.md) — legacy live-session exposure risks and non-goals.
