# Security

## Local-first trust model

Rotom Table is currently a local-first, trust-based tabletop tool. The GM/Player local role model is a role picker backed by a cookie; it is not hardened public authentication.

GM-hosted live sessions add a guarded session-local join flow for trusted tables, but they do not turn Rotom Table into a hardened public service. See [docs/live-session-security-boundaries.md](docs/live-session-security-boundaries.md) for the current live session trust boundaries, join-code limits, tunnel exposure risks, and non-goals. See [docs/live-session-security-secret-hygiene-readiness.md](docs/live-session-security-secret-hygiene-readiness.md) for the current review of auth/session/cookie/permission boundaries, public exposure warnings, committed-data hygiene, and remaining security non-goals. See [docs/live-session-persistence-recovery-maintenance.md](docs/live-session-persistence-recovery-maintenance.md) for the current review of session snapshots, optional event logs, backup/recovery docs, and local data hygiene. See [docs/live-session-dependency-runtime-maintenance.md](docs/live-session-dependency-runtime-maintenance.md) for the reviewed dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare tunnel assumptions.

## Private VPS mode

Private VPS hosting is still private trusted-table hosting. It can keep a known campaign group online through a GM/operator-controlled Node process, but it does not harden the app for arbitrary public visitors.

Private VPS mode still requires an outer access gate such as VPN/Tailscale, Cloudflare Access, private network controls, or reverse-proxy basic authentication for the trusted table. That gate is separate from the GM/Player role picker; **GM Login is not enough** to protect a URL that arbitrary internet users can reach. See [docs/private-vps-hosting.md](docs/private-vps-hosting.md) for the current private VPS boundary and access-gate checklist.

Covered filesystem writes fail closed in production unless the private operator explicitly sets `ROTOM_ENABLE_HOSTED_WRITES=1`, but that flag is not authentication, authorization, rate limiting, abuse monitoring, or a replacement for backups. Campaign JSON, private deployment configuration, and backup archives remain sensitive operator-controlled data and should stay outside the public/shareable app checkout.

## Public service mode is separate

Do not expose this application publicly without replacing the current auth and persistence assumptions. A public service design should include, at minimum:

- real authentication and authorization;
- a persistence layer designed for hosted use instead of repository-tree JSON writes;
- route-by-route review of mutating API surfaces (see the current private-hosting [API route mutation audit](docs/api-route-mutation-audit.md));
- content/asset rights review;
- separation of private campaign data from public/static reference data;
- operational controls appropriate for public exposure, such as abuse monitoring, rate limiting, backup/restore practice, and incident response.

## Sensitive data

Do not share or commit real campaign/private data, credentials, secrets, private player information, unreleased story notes, production environment files, deployment logs, screenshots that show private campaign state, or backup archives in Git, issue trackers, reviews, logs, or chat.

The repository ignores common local environment files such as `.env` and `.env.*`; keep secrets, real deployment configuration, private campaign data, and generated backups out of Git.

## Reporting issues

If you find a security issue, report it privately to the repository owner/maintainer rather than posting exploit details publicly. Include:

- a short description of the issue
- reproduction steps
- affected routes or files, if known
- whether private data, filesystem writes, or role boundaries are involved

Because this is a hobby/local-first project, response times may vary, but reports that affect data safety or public exposure assumptions should be treated seriously.
