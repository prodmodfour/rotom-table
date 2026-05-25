# Rotom Table docs

This directory collects presentation and reviewer documentation for Rotom Table. The goal is to make the project easy to evaluate without changing application behaviour.

## Start here

- [Review guide](review-guide.md) — what to inspect first, key routes, source areas, scripts, and production caveats.
- [Architecture](architecture.md) — high-level Nuxt/Nitro/local-first architecture.
- [Data model](data-model.md) — maps, sheets, trainers, encounter tables, app-owned PTU reference content, generated sheets, and local data hygiene.
- [Local development](local-development.md) — setup commands, checks, optional `just` recipes, and local filesystem behaviour.
- [Screenshots](screenshots.md) — capture checklist for future screenshots; no missing images are linked.
- [Track 1 performance roadmap](track-1-performance-roadmap.md) — no-quality-loss performance constraints, benchmark categories, and staged isometric map optimization plan.
- [Track 2 roadmap](track-2-roadmap.md) — locked GM-hosted session scope, lifecycle, concurrency model, roadmap phases, and non-goals.
- [Track 2 glossary](track-2-glossary.md) — shared vocabulary for session identity, commands, revisions, WebSocket flow, persistence, and safety boundaries.
- [Track 2 validation matrix](track-2-validation-matrix.md) — expected tests, smoke checks, docs, and safety reviews for later implementation areas.
- [Track 2 session protocol](track-2-session-protocol.md) — shared identity, command envelope, result, WebSocket message, ack/reject, duplicate, and reconnect contracts.
- [Track 2 session storage](track-2-session-storage.md) — default snapshot/event-log paths, ignored/private data boundaries, backup guidance, cleanup behaviour, and recovery limitations.
- [ADR 001: GM-hosted session model](adrs/001-gm-hosted-session-model.md) — decision record for GM-controlled sessions instead of SaaS, public multi-tenancy, or generic collaborative editing.
- [ADR 002: LAN first and named Cloudflare Tunnel second](adrs/002-lan-first-named-cloudflare-tunnel.md) — decision record for LAN-first hosting, named-tunnel remote access, and Quick Tunnel caveats.
- [ADR 003: WebSocket session transport](adrs/003-websocket-session-transport.md) — decision record for using WebSockets for live session commands, acks/rejections, broadcasts, heartbeat, and reconnect.
- [ADR 004: Server-authoritative commands](adrs/004-server-authoritative-commands.md) — decision record for command envelopes instead of live whole-map autosave, including local-first compatibility boundaries.
- [ADR 005: Session identity and permissions](adrs/005-session-identity-and-permissions.md) — decision record for session-local GM/player identity, join codes, display names, assignments, and server-enforced permissions without full accounts.
- [ADR 006: Revisions and conflict rules](adrs/006-revisions-and-conflict-rules.md) — decision record for monotonic revisions, `opId` idempotency, stale command handling, GM precedence, and per-resource conflicts.
- [ADR 007: JSON snapshots and optional event log](adrs/007-json-snapshots-and-optional-event-log.md) — decision record for local-first session snapshots, atomic writes, optional append-only event logs, and recovery expectations.
- [ADR 008: Session runtime safety flag](adrs/008-session-runtime-safety-flag.md) — decision record for the explicit session-host opt-in flag, fail-closed session routes, and public exposure warnings.
- [Isometric render scheduler architecture](render-scheduler-architecture.md) — dirty rendering flow, active animation sources, and how to add future invalidation reasons.
- [Performance benchmark scenarios](performance-benchmark-scenarios.md) — empty, typical campaign, and stress map scenarios plus before/after PR metrics to record.
- [Performance benchmark fixtures](performance-benchmark-fixtures.md) — local fixture generator and manual checklist for reproducing benchmark maps without private campaign data.
- [Performance benchmark runbook](performance-benchmark-runbook.md) — step-by-step before/after measurement workflow and debug overlay interpretation guide.
- [Track 1 integrated benchmark pass](performance-benchmark-results.md) — recorded empty, typical, and stress fixture measurements from the integrated Track 1 branch.
- [Track 1 no-quality-loss audit](performance-no-quality-loss-audit.md) — final Track 1 audit confirming no intentional visual-quality or functionality reduction.
- [Track 1 final implementation review](performance-track-1-final-review.md) — completion readiness checklist, completed chunk PR coverage, and final automation handoff notes.
- [Performance guardrails](performance-guardrails.md) — reviewer checklist and automated checks that prevent performance work from reducing visual quality or map functionality.
- [Fan project notice](fan-project-notice.md) — unofficial fan-project boundaries.

## Existing technical notes

- [Map v2](maps-v2.md) — current map document shape and render layers.
- [Move automation requirements](move-automation-requirements.md) — design notes for map move automation coverage.
- [Pokémon size outliers](pokemon-size-outliers.md) — data notes for sprite/map scale edge cases.
