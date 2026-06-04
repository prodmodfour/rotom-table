# Rotom Table docs

This directory collects presentation and reviewer documentation for Rotom Table. The goal is to make the project easy to evaluate without changing application behaviour.

## Start here

- [Review guide](review-guide.md) — what to inspect first, key routes, source areas, scripts, and production caveats.
- [Architecture](architecture.md) — high-level Nuxt/Nitro/local-first architecture.
- [Data model](data-model.md) — maps, sheets, trainers, player profiles, encounter tables, app-owned PTU reference content, generated sheets, and local data hygiene.
- [Campaign repositories](campaign-repositories.md) — using `ROTOM_CAMPAIGN_ROOT` to keep private campaign JSON in a separate Git repository.
- [Player profiles and linked character control](player-profiles.md) — normal player login/profile selection, GM profile management, linked sheet editing, player-visible map control, and reference browsing.
- [Local development](local-development.md) — setup commands, checks, optional `just` recipes, and local filesystem behaviour.
- [Private VPS hosting scope](private-vps-hosting.md) — initial private trusted-table VPS boundary, non-goals, and links to local-first/security docs.
- [Private VPS backup runbook](private-vps-backups.md) — before/after-session campaign archives, private deployment config notes, retention guidance, and Git hygiene.
- [API route mutation audit](api-route-mutation-audit.md) — non-GET API route classifications, hosted-write coverage, and remaining limitations.
- [Screenshots](screenshots.md) — capture checklist for future screenshots; no missing images are linked.
- [Map rendering performance roadmap](map-rendering-performance-roadmap.md) — no-quality-loss performance constraints, benchmark categories, and staged isometric map optimization plan.
- [Live session roadmap](live-session-roadmap.md) — legacy GM-hosted live session scope, lifecycle, concurrency model, roadmap phases, and non-goals; not the normal profile-based play path.
- [Live session glossary](live-session-glossary.md) — shared vocabulary for session identity, commands, revisions, session socket flow, persistence, and safety boundaries.
- [Live session validation matrix](live-session-validation-matrix.md) — current profile-play validation areas plus isolated legacy session maintenance checks.
- [Live session protocol](live-session-protocol.md) — shared identity, command envelope, result, session socket message, ack/reject, duplicate, and reconnect contracts.
- [Live session socket protocol](live-session-socket-protocol.md) — live session socket route, message examples, heartbeat, reconnect, command flow, and named-tunnel expectations.
- [Live session table action commands](live-session-table-action-commands.md) — supported HP, condition, initiative, move/action, hazard, field-effect, and terrain session commands with permissions, conflicts, and limitations.
- [Live session client integration](live-session-client-integration.md) — legacy live-session client boundary notes; normal play uses player profiles on `/maps/<slug>` and old session-map client helpers have been removed.
- [live session lobby and manual QA](live-session-lobby.md) — direct-only legacy session identity/socket lobby boundaries and two-browser smoke checklist; not normal profile-based play.
- [live session host runtime scripts](live-session-host-runtime.md) — npm helpers for guarded LAN and named-tunnel session host startup.
- [Live session public exposure checks](live-session-public-exposure-checks.md) — no-secret safety banner checks for unsafe public/LAN startup states before sharing join codes.
- [Live session LAN hosting runbook](live-session-lan-hosting.md) — same-Wi-Fi/LAN setup commands, IP discovery, player join URLs, smoke checks, and troubleshooting.
- [Live session named Cloudflare Tunnel runbook](live-session-cloudflare-tunnel-hosting.md) — stable-hostname remote setup, session socket considerations, safety warnings, and rollback steps.
- [Live session named-tunnel maintenance checklist](live-session-named-tunnel-maintenance.md) — named-tunnel doc accuracy, current Cloudflare assumptions, and safety warnings.
- [Live session deployment smoke checklist](live-session-deployment-smoke-checklist.md) — legacy session lobby/socket smoke notes; not normal profile-based play.
- [Live session LAN manual smoke results](live-session-lan-manual-smoke-results.md) — recorded LAN browser-client smoke results for guarded startup, two-player join, session socket presence, reconnect, and cleanup.
- [Live session command-flow maintenance](live-session-command-flow-maintenance.md) — automated multi-client command-flow coverage covering accepted commands, reconnect, permissions, and stale conflicts.
- [Live session concurrency benchmark notes](live-session-concurrency-benchmark-notes.md) — legacy session socket benchmark notes; current profile play uses saved-map realtime and linked-token tests.
- [Live session implementation maintenance](live-session-implementation-maintenance.md) — product docs, source areas, validation evidence, and known limitations.
- [Live session product readiness review](live-session-product-readiness-review.md) — concise product/developer readiness review for architecture, table flow, validation, limits, and operator checks.
- [Live session readiness summary](live-session-readiness-summary.md) — product/developer readiness summary for validation, evidence links, and architecture confirmation.
- [Live session local-mode maintenance checks](live-session-local-mode-maintenance.md) — local-first maintenance checks for plain map/sheet workflows, profile play, legacy SSE, and legacy session isolation.
- [Live session Quick Tunnel caveat](live-session-quick-tunnel-caveat.md) — temporary development smoke-test boundary, campaign-session rejection, and legacy SSE limitations.
- [live session storage](live-session-storage.md) — default snapshot/event-log paths, ignored/private data boundaries, backup guidance, cleanup behaviour, and recovery limitations.
- [Live session backup and recovery](live-session-backup-recovery.md) — private backup/restore runbook for snapshots, optional event logs, referenced campaign data, and local-only recovery limits.
- [Live session persistence/recovery maintenance](live-session-persistence-recovery-maintenance.md) — snapshots, optional event logs, backup/restore docs, cleanup, and local data hygiene.
- [Live session security boundaries](live-session-security-boundaries.md) — trust boundaries, non-hardened areas, join-code limits, tunnel exposure risks, incident response, and security non-goals.
- [Live session security and secret-hygiene readiness](live-session-security-secret-hygiene-readiness.md) — auth/session/cookie/permission boundaries, public exposure warnings, committed-data hygiene, and remaining non-goals.
- [Live session dependency and runtime maintenance](live-session-dependency-runtime-maintenance.md) — dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare tunnel assumptions.
- [ADR 001: GM-hosted session model](adrs/001-gm-hosted-session-model.md) — decision record for GM-controlled sessions instead of SaaS, public multi-tenancy, or generic collaborative editing.
- [ADR 002: LAN first and named Cloudflare Tunnel second](adrs/002-lan-first-named-cloudflare-tunnel.md) — decision record for LAN-first hosting, named-tunnel remote access, and Quick Tunnel caveats.
- [ADR 003: Session socket transport](adrs/003-session-socket-transport.md) — decision record for using the session socket for live session commands, acks/rejections, broadcasts, heartbeat, and reconnect.
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md) — decision record for command envelopes instead of live whole-map autosave, including local-first compatibility boundaries.
- [ADR 005: Session identity and permissions](adrs/005-session-identity-and-permissions.md) — decision record for session-local GM/player identity, join codes, display names, assignments, and server-enforced permissions without full accounts.
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md) — decision record for monotonic revisions, `opId` idempotency, stale command handling, GM precedence, and per-resource conflicts.
- [ADR 007: JSON snapshots and optional event log](adrs/007-json-snapshots-and-optional-event-log.md) — decision record for local-first session snapshots, atomic writes, optional append-only event logs, and recovery expectations.
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md) — decision record for the explicit session-host opt-in flag, fail-closed session routes, and public exposure warnings.
- [Isometric render scheduler architecture](render-scheduler-architecture.md) — dirty rendering flow, active animation sources, and how to add future invalidation reasons.
- [Performance benchmark scenarios](performance-benchmark-scenarios.md) — empty, typical campaign, and stress map scenarios plus before/after PR metrics to record.
- [Performance benchmark fixtures](performance-benchmark-fixtures.md) — local fixture generator and manual checklist for reproducing benchmark maps without private campaign data.
- [Performance benchmark runbook](performance-benchmark-runbook.md) — step-by-step before/after measurement workflow and debug overlay interpretation guide.
- [Map rendering integrated benchmark pass](performance-benchmark-results.md) — recorded empty, typical, and stress fixture measurements from the current performance implementation.
- [Map rendering no-quality-loss guardrails](performance-no-quality-loss.md) — map rendering performance guardrails confirming no intentional visual-quality or functionality reduction.
- [Map rendering performance readiness](performance-readiness.md) — performance readiness checklist, validation coverage, and no-quality-loss evidence.
- [Performance guardrails](performance-guardrails.md) — reviewer checklist and automated checks that prevent performance work from reducing visual quality or map functionality.
- [Fan project notice](fan-project-notice.md) — unofficial fan-project boundaries.

## Existing technical notes

- [Map v2](maps-v2.md) — current map document shape and render layers.
- [Move automation requirements](move-automation-requirements.md) — design notes for map move automation coverage.
- [Move animations implementation brief](move-animations.md) — user-facing release note, disable/reduced-motion controls, scope, UX, visual-only boundaries, and expected source areas for the basic move VFX layer.
- [Move animation manual QA checklist](move-animation-manual-qa.md) — repeatable browser review scenarios for hits, misses, crits, self/healing/status/buff/area/pass effects, reduced motion, disabled animations, lifecycle, persistence, and blocker/polish classification.
- [Move VFX first-playtest follow-up issues](move-vfx-follow-up-issues.md) — first realistic map playtest notes, blocker/polish triage, and small follow-up issue list for readability, accessibility, performance validation, and future bespoke wishes.
- [Pokémon size outliers](pokemon-size-outliers.md) — data notes for sprite/map scale edge cases.
