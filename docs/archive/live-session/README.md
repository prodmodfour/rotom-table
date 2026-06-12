# Archived legacy live-session documents

> These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.

Normal Rotom Table multiplayer play uses persistent player profiles on regular `/maps/<slug>` routes and the server-authoritative live-play command model. See [Live play authority](../../live-play-authority.md) for the current architecture.

The legacy `/sessions` page, `/api/sessions/*` endpoints, and `WebSocket /api/sessions/socket` remain maintenance-only while that guarded surface exists. Session hosting still fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is set.

## Archived documents

- [Live session roadmap](live-session-roadmap.md)
- [Live session glossary](live-session-glossary.md)
- [Live session validation matrix](live-session-validation-matrix.md)
- [Live session protocol](live-session-protocol.md)
- [Live session socket protocol](live-session-socket-protocol.md)
- [Live session table action commands](live-session-table-action-commands.md)
- [Live session client integration](live-session-client-integration.md)
- [Live session lobby and manual QA](live-session-lobby.md)
- [Live session host runtime scripts](live-session-host-runtime.md)
- [Live session public exposure checks](live-session-public-exposure-checks.md)
- [Live session LAN hosting runbook](live-session-lan-hosting.md)
- [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md)
- [Live session named-tunnel maintenance checklist](live-session-named-tunnel-maintenance.md)
- [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md)
- [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md)
- [Live session command-flow maintenance](live-session-command-flow-maintenance.md)
- [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md)
- [Live session implementation maintenance](live-session-implementation-maintenance.md)
- [Live session product readiness review](live-session-product-readiness-review.md)
- [Live session readiness summary](live-session-readiness-summary.md)
- [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md)
- [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md)
- [Live session storage](live-session-storage.md)
- [Live session backup and recovery](live-session-backup-recovery.md)
- [Live session persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md)
- [Live session security boundaries](live-session-security-boundaries.md)
- [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md)
- [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md)

## Archived ADRs

- [ADR 001: GM-hosted session model](adrs/001-gm-hosted-session-model.md)
- [ADR 002: LAN first and named Cloudflare Tunnel second](adrs/002-lan-first-named-cloudflare-tunnel.md)
- [ADR 003: Session socket transport](adrs/003-session-socket-transport.md)
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md)
- [ADR 005: Session identity and permissions](adrs/005-session-identity-and-permissions.md)
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md)
- [ADR 007: JSON snapshots and optional event log](adrs/007-json-snapshots-and-optional-event-log.md)
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md)
