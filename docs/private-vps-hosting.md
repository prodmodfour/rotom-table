# Private VPS hosting scope

Rotom Table's first VPS target is **private trusted-table hosting**: one GM/operator-controlled Node/Nitro process for a known campaign group. It extends the local-first workflow to a private host, but it does not turn Rotom Table into a public website or managed service.

## Safe first use

Use this mode only when all of these are true:

- the VPS is operated by the GM or another trusted table operator;
- access to the app is restricted by an outer gate such as a private network, VPN/Tailscale, reverse-proxy authentication, Cloudflare Access, SSH tunnel, or equivalent provider controls; see [Outer access gate](#outer-access-gate) before sharing the URL;
- participants are known table members who already trust the GM/operator and campaign data;
- campaign JSON stays in private operator-controlled storage, preferably through `ROTOM_CAMPAIGN_ROOT` as described in [Campaign repositories](campaign-repositories.md);
- the operator understands the local-first filesystem model in [Local development](local-development.md) and the security expectations in [Security](../SECURITY.md).

The built Nitro server can be used for private host smoke checks with Node.js 24 LTS, `npm run build`, `npm run start`, and the no-secret `/api/health` endpoint. After every deploy, follow the [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) before sharing the private URL with players. Keep normal profile-based play intact: the GM manages profiles from `/players`, players choose **Player Login**, and players open the regular player-visible routes such as `/maps/<slug>`.

## Environment example

Use the placeholder-only [`.env.vps.example`](../.env.vps.example) as a starting point for a private host's service manager environment or for an untracked `.env` file loaded by the deployment. It sets `NODE_ENV=production`, loopback Nitro bind settings, and an example `ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign` so campaign-owned JSON stays outside the application checkout. Replace paths and bind settings for your host, but keep real `.env` files, hostnames, credentials, and campaign data out of Git.

## Primary process management path

The primary private VPS process-management path is **systemd with a direct Node.js 24 runtime**. This keeps Rotom Table close to the existing local-first filesystem model: the service runs the built Nitro server from the app checkout, while campaign JSON stays in `/srv/rotom-table/campaign` through `ROTOM_CAMPAIGN_ROOT`.

A manual smoke for the same command that systemd should supervise is:

```bash
cd /srv/rotom-table/app
npm ci
npm run build
NODE_ENV=production \
NITRO_HOST=127.0.0.1 \
NITRO_PORT=3000 \
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign \
npm run start
```

Then confirm the built server is reachable only through the intended private path:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

For unattended VPS operation, use the example unit at [`deploy/systemd/rotom-table.service`](../deploy/systemd/rotom-table.service) as a reviewable starting point and install the reviewed copy as `/etc/systemd/system/rotom-table.service`. The example runs as a non-root `rotom-table` user/group, sets `WorkingDirectory=/srv/rotom-table/app`, loads app settings from `EnvironmentFile=/etc/rotom-table/rotom-table.env`, starts the built server with `npm run start`, and defines `Restart=on-failure` with a short `RestartSec` delay. If an operator does not want the npm wrapper, the equivalent command is `node .output/server/index.mjs` from the same working directory.

The real systemd environment file should live outside the app checkout, for example at `/etc/rotom-table/rotom-table.env`, and should be copied from `.env.vps.example` or written with the same key names and host-specific values. Keep it untracked and root-readable only, for example `0600`, because it may contain private paths or future secrets. It should set the selected private host values such as `NODE_ENV=production`, `NITRO_HOST=127.0.0.1`, `NITRO_PORT=3000`, `ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign`, and the optional exact hosted-write opt-in only when the private host is ready for campaign writes.

A minimal install flow after creating `/srv/rotom-table/app` and building the app is:

```bash
id -u rotom-table >/dev/null 2>&1 || sudo useradd --system --home-dir /srv/rotom-table --shell /usr/sbin/nologin rotom-table
sudo install -d -o rotom-table -g rotom-table -m 0750 /srv/rotom-table/campaign /srv/rotom-table/backups
sudo install -d -o root -g root -m 0750 /etc/rotom-table
sudo install -o root -g root -m 0600 .env.vps.example /etc/rotom-table/rotom-table.env
sudo editor /etc/rotom-table/rotom-table.env
sudo install -o root -g root -m 0644 deploy/systemd/rotom-table.service /etc/systemd/system/rotom-table.service
sudo systemctl daemon-reload
sudo systemctl enable --now rotom-table.service
```

Ensure the `rotom-table` service user can read `/srv/rotom-table/app` and write the configured campaign root before enabling the service. After each planned deploy, rebuild the app and use `systemctl restart rotom-table.service`; standard output and error go to journald so logs are available with `journalctl -u rotom-table.service` or `journalctl -u rotom-table.service -f`.

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

WebSocket upgrade support must work end-to-end for legacy `/sessions` maintenance surfaces such as `WebSocket /api/sessions/socket` and for any future realtime endpoints. Caddy's `reverse_proxy` handles WebSocket upgrades by default; if you replace this example with nginx or another proxy, explicitly configure HTTP/1.1 upgrade forwarding and test the socket path before sharing the host with players.

The reverse proxy is only transport and TLS plumbing. It is not Rotom Table authentication, not the GM/Player role picker, and not a public-hosting safety layer by itself. Keep the Node service unexposed on `127.0.0.1`, restrict the HTTPS URL with the required outer access gate for the trusted table, and keep real hostnames, credentials, certificates, access-policy exports, and proxy logs out of Git.

## Outer access gate

A private VPS URL must not be reachable by arbitrary internet users. Put an outer access gate in front of the Rotom Table origin before sharing the URL with players, and verify that the gate protects the app before the `/login` page, `/api/health`, other `/api/*` routes, and WebSocket upgrade paths.

Acceptable gate examples include the following. Choose the one that fits the host and table; no single vendor is required.

- A private network or firewall rule that only allows trusted LAN/private-subnet clients and blocks direct public access.
- A VPN or mesh network such as Tailscale or WireGuard where only known table devices can reach the hostname.
- Cloudflare Access or an equivalent identity-aware proxy that allows only the trusted campaign group.
- Reverse-proxy basic authentication for a trusted group, served only over HTTPS, with strong shared credentials kept outside Git and rotated if they are shared too broadly.
- An SSH tunnel or comparable provider control that keeps the app reachable only from explicitly approved operator/player devices.

The outer gate is separate from Rotom Table's GM/Player role picker. **GM Login is not enough** for a private VPS: it is a table workflow role choice after a visitor has reached the app, not a password, account system, or public authentication layer. Anyone who can reach the app may be able to choose a local role, so the gate should admit only known table members who already trust the GM/operator.

Before sharing a host URL, confirm these checks:

- the Nitro process still binds to `127.0.0.1`, and the VPS firewall blocks direct public access to the Node port such as `:3000`;
- an off-network or unauthenticated browser cannot load `/login` or `/api/health`;
- the same outer gate covers normal page loads, mutating API routes, and WebSocket upgrades;
- access-gate configs, basic-auth password files, tunnel credentials, private hostnames, provider policy exports, and logs stay out of Git.

## VPS campaign data layout

A simple private VPS can keep the app, campaign data, and backups under one operator-controlled parent while still separating the public/shareable app checkout from private campaign JSON:

```text
/srv/rotom-table/
  app/                    # application checkout and built .output/ server
  campaign/               # ROTOM_CAMPAIGN_ROOT; private campaign JSON only
    data/
      maps/
      sheets/
      trainers/
      player-profiles/
    encounter_tables/
  backups/                # private backup archives or restore staging, not Git
```

With that layout, run the built app from `/srv/rotom-table/app` and set:

```bash
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign
```

Rotom Table then resolves campaign-owned paths under the campaign root: maps at `/srv/rotom-table/campaign/data/maps/`, Pokémon sheets at `/srv/rotom-table/campaign/data/sheets/`, trainer sheets at `/srv/rotom-table/campaign/data/trainers/`, player profiles at `/srv/rotom-table/campaign/data/player-profiles/`, and encounter tables at `/srv/rotom-table/campaign/encounter_tables/`. App-owned reference data such as `data/reference/` remains in the application checkout.

Do not store private maps, sheets, trainers, player profiles, encounter tables, backups, or unreleased campaign notes in a public or shared app repository checkout. Keep `/srv/rotom-table/campaign` and `/srv/rotom-table/backups` private to the operator and exclude real `.env` files and generated archives from Git.

For step-by-step private archives before and after a session, plus a temporary restore smoke check, use the [Private VPS backup runbook](private-vps-backups.md).

## Hosted write policy

Private VPS filesystem writes must fail closed in production unless the operator explicitly opts in. The selected flag is `ROTOM_ENABLE_HOSTED_WRITES`, enforced by server-side write policy on map, sheet, encounter-table, persistent encounter-generation, player-profile, Pokédex maintenance, and campaign next-day routes that have been moved off the older production-only block.

- **Disabled by default:** when `NODE_ENV=production`, hosted writes are disabled if the flag is unset or set to anything other than exactly `1`. Values such as `true`, `yes`, `on`, or `enabled` do not enable writes. Routes covered by the hosted-write policy reject with a clear 403-style message instead of writing.
- **Enabled for private hosts:** `NODE_ENV=production` plus `ROTOM_ENABLE_HOSTED_WRITES=1` opts the private instance into covered filesystem writes for trusted table use. Use this only with an outer access gate and operator-controlled campaign storage such as `ROTOM_CAMPAIGN_ROOT`.
- **Development remains unchanged:** non-production local development writes keep working without the hosted-write flag, so `npm run dev` and existing local campaign workflows are not gated by VPS settings.
- **Scope:** the flag controls server-side filesystem persistence only. It is not authentication, authorization, a public-hosting safety layer, or a substitute for backups and route review. See the [API route mutation audit](api-route-mutation-audit.md) for the current route-by-route coverage, including map routes. GM map library writes still require GM role, and player map/token writes still require player-visible maps plus selected-profile token control.

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
- [Local development](local-development.md) — local-first filesystem behaviour, checks, and production write limitations.
- [Campaign repositories](campaign-repositories.md) — using `ROTOM_CAMPAIGN_ROOT` to keep private campaign JSON separate from the app checkout.
- [Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md) — after-deploy install, validation, start, health, outer-gated profile play, persistence, Git hygiene, and legacy `/sessions` boundary checks.
- [Private VPS backup runbook](private-vps-backups.md) — creating private campaign and deployment-config backups before and after sessions, then smoke-checking a temporary restore without committing archives.
- [API route mutation audit](api-route-mutation-audit.md) — current non-GET route classifications, hosted-write coverage, and remaining limitations.
- [Player profiles and linked character control](player-profiles.md) — normal GM/player profile flow for table play.
- [Live session security boundaries](live-session-security-boundaries.md) — legacy live-session exposure risks and non-goals.
