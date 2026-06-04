# Private VPS hosting scope

Rotom Table's first VPS target is **private trusted-table hosting**: one GM/operator-controlled Node/Nitro process for a known campaign group. It extends the local-first workflow to a private host, but it does not turn Rotom Table into a public website or managed service.

## Safe first use

Use this mode only when all of these are true:

- the VPS is operated by the GM or another trusted table operator;
- access to the app is restricted by an outer gate such as a private network, VPN/Tailscale, reverse-proxy authentication, Cloudflare Access, SSH tunnel, or equivalent provider controls;
- participants are known table members who already trust the GM/operator and campaign data;
- campaign JSON stays in private operator-controlled storage, preferably through `ROTOM_CAMPAIGN_ROOT` as described in [Campaign repositories](campaign-repositories.md);
- the operator understands the local-first filesystem model in [Local development](local-development.md) and the security expectations in [Security](../SECURITY.md).

The built Nitro server can be used for private host smoke checks with Node.js 24 LTS, `npm run build`, `npm run start`, and the no-secret `/api/health` endpoint. Keep normal profile-based play intact: the GM manages profiles from `/players`, players choose **Player Login**, and players open the regular player-visible routes such as `/maps/<slug>`.

## Environment example

Use the placeholder-only [`.env.vps.example`](../.env.vps.example) as a starting point for a private host's service manager environment or for an untracked `.env` file loaded by the deployment. It sets `NODE_ENV=production`, loopback Nitro bind settings, and an example `ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign` so campaign-owned JSON stays outside the application checkout. Replace paths and bind settings for your host, but keep real `.env` files, hostnames, credentials, and campaign data out of Git.

## Hosted write policy

Private VPS filesystem writes must fail closed in production unless the operator explicitly opts in. The selected flag is `ROTOM_ENABLE_HOSTED_WRITES`, enforced by server-side write policy on the sheet, encounter-table, persistent encounter-generation, player-profile, Pokédex maintenance, and campaign next-day routes that have been moved off the older production-only block.

- **Disabled by default:** when `NODE_ENV=production`, hosted writes are disabled if the flag is unset or set to anything other than exactly `1`. Values such as `true`, `yes`, `on`, or `enabled` do not enable writes. Routes covered by the hosted-write policy reject with a clear 403-style message instead of writing.
- **Enabled for private hosts:** `NODE_ENV=production` plus `ROTOM_ENABLE_HOSTED_WRITES=1` opts the private instance into covered filesystem writes for trusted table use. Use this only with an outer access gate and operator-controlled campaign storage such as `ROTOM_CAMPAIGN_ROOT`.
- **Development remains unchanged:** non-production local development writes keep working without the hosted-write flag, so `npm run dev` and existing local campaign workflows are not gated by VPS settings.
- **Scope:** the flag controls server-side filesystem persistence only. It is not authentication, authorization, a public-hosting safety layer, or a substitute for backups and route review. See the [API route mutation audit](api-route-mutation-audit.md) for the current route-by-route coverage. Map write routes remain pending hosted-mode review and should not be treated as supported private VPS write surfaces until that review is complete.

## What this is not

Private VPS hosting is not any of the following:

- public anonymous signup;
- public SaaS or multi-tenant hosting;
- a hardened public authentication system;
- a promise that every mutating route is safe for arbitrary internet users;
- a replacement for a hosted database, account system, rate limiting, abuse monitoring, content-rights review, or incident-response program.

The **GM / Player** picker and persistent player profiles are table workflow controls, not public authentication. Anyone who can reach the app may be able to choose a local role unless an outer access gate blocks them first.

## Out of scope for the initial target

Before treating a hosted instance as a regular remote table, document and verify the remaining operational pieces for that host: environment variable values, production write policy enforcement, route mutation review, map hosted-mode behaviour, process management, reverse proxy behaviour, access-gate configuration, backups, restores, and deployment smoke checks.

Until those pieces are documented for the specific host, keep hosted use private, conservative, and reversible. If the trust boundary is unclear, run Rotom Table locally instead.

## Related docs

- [Security](../SECURITY.md) — trust-based security expectations and public-exposure non-goals.
- [Local development](local-development.md) — local-first filesystem behaviour, checks, and production write limitations.
- [Campaign repositories](campaign-repositories.md) — using `ROTOM_CAMPAIGN_ROOT` to keep private campaign JSON separate from the app checkout.
- [API route mutation audit](api-route-mutation-audit.md) — current non-GET route classifications, hosted-write coverage, and remaining map-route limitation.
- [Player profiles and linked character control](player-profiles.md) — normal GM/player profile flow for table play.
- [Live session security boundaries](live-session-security-boundaries.md) — legacy live-session exposure risks and non-goals.
