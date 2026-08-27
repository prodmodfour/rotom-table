# Security

## Supported security boundary

Rotom Table is a private trusted-table application for one known campaign group. The supported deployment is the production Nuxt/Nitro build on a private Linux x86-64 VPS, managed by a GM/operator and protected by an outer access gate.

The GM/Player picker stores a trusted role choice in browser state. It is **not public authentication**, does not establish a real-world identity, and is not sufficient protection for an internet-reachable URL. Player-profile links enforce in-app role projection only after a participant is already inside the trusted table boundary.

The archive at [docs/archive/live-session/README.md](docs/archive/live-session/README.md) is not the current multiplayer architecture or a supported security contract; current profile-based liveplay and this private-VPS boundary supersede it.

Use VPN/Tailscale, Cloudflare Access, reverse-proxy authentication, private-network controls, or an equivalent gate before traffic reaches Rotom Table. Bind Nitro to loopback unless the private network design provides an equivalent boundary. See [the private VPS runbook](docs/private-vps-hosting.md) and [deployment checklist](docs/private-vps-deployment-smoke-checklist.md).

## Campaign and operator authority

SQLite under `ROTOM_CAMPAIGN_ROOT` is authoritative for campaign runtime state. Residual campaign JSON, reference overrides, signing secrets, environment configuration, logs, and backup archives are also private operator material. Keep all of them outside the shareable source checkout and restrict filesystem access to the service operator.

Production campaign writes fail closed unless the operator sets `ROTOM_ENABLE_HOSTED_WRITES=1`. That flag is only a deliberate write opt-in. It is not authentication, authorization, rate limiting, abuse protection, encryption, monitoring, or a backup.

Follow the documented [backup and restore procedure](docs/private-vps-backups.md). Never use an ordinary live-file copy of an active SQLite/WAL database as a backup.

## Unsupported public-service exposure

Do not expose the current application as a public SaaS, multi-tenant service, or arbitrary-internet application. A separately reviewed public-service design would need, at minimum:

- real authentication, authorization, account recovery, and session hardening;
- tenant and campaign isolation;
- route-by-route mutating-surface review (start with the [API mutation audit](docs/api-route-mutation-audit.md));
- rate limiting, abuse monitoring, operational alerting, and incident response;
- a hosted persistence and secret-management design;
- public-service privacy, retention, and legal/content-rights review.

No current release claim covers those properties.

## Sensitive-data handling

Do not put any of the following in Git, issues, pull requests, browser traces, screenshots, logs shared for support, or chat:

- real campaign databases, WAL/SHM files, JSON exports, or backups;
- credentials, tokens, signing secrets, environment files, hostnames, or access-gate configuration;
- player identities, private profile links, character notes, unreleased story material, or GM-only mechanics;
- production request bodies, deployment logs, or screenshots containing private campaign state.

Use synthetic fixtures and redact paths, identifiers, and values before sharing a reproduction. The registered source-tree hygiene gate is documented in [docs/release/source-tree-hygiene.md](docs/release/source-tree-hygiene.md).

## Supported versions and response expectations

Security maintenance is best effort for the current release line only. During release-candidate preparation that means the current `1.0.0-rc.N` source; after 1.0 it means the latest published `1.0.x` unless a later policy says otherwise. Older commits, modified forks, development hosting, unsupported platforms, and public exposure receive no security compatibility promise.

This is a hobby/private-table project. There is no paid support contract, bug bounty, response-time SLA, uptime guarantee, or promise of a private patch. Data-safety and boundary failures are treated seriously, but maintainer availability varies. See [support expectations](docs/support.md).

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner/maintainer using GitHub private vulnerability reporting when available, or another existing private owner channel. Do not open a public issue with exploit details or private evidence.

Include only a redacted, synthetic report:

- affected version or commit;
- short impact statement;
- minimal reproduction steps;
- affected route, projection, or storage boundary;
- whether the issue can expose private data, cross a GM/Player projection, mutate storage, or bypass the outer-gate assumption;
- a safe proposed mitigation, if known.

If a report concerns an internet-exposed deployment without an outer gate, first remove that deployment from public reach; public exposure is outside the supported security boundary.
