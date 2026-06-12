# ADR 009: Server-authoritative profile play

Date: 2026-06-12

Status: Accepted

## Context

Rotom Table's normal multiplayer workflow now uses persistent player profiles on the regular saved-map routes. Players select a GM-created profile after Player Login, open player-visible maps at `/maps/<slug>`, and control tokens whose placed sheet refs match that profile's linked characters.

Older live-session documents and `/sessions` routes describe a guarded session-local identity/socket surface. That surface is retained only for legacy maintenance while it exists. It is not the direction for normal profile-based play.

The remaining architecture gap is live gameplay authority. Browser-owned whole-map autosave is useful for GM setup/edit workflows and local single-user maintenance, but it is not a safe concurrency model for live table play. If multiple browsers can change gameplay state at once, the server must validate explicit player/GM intent, apply it once, advance revisions, persist it, and broadcast the accepted result.

## Decision

Normal multiplayer play uses **server-authoritative profile commands** on the regular `/maps/<slug>` route family.

The live-play model is:

- **Routes:** normal play stays on `/maps/<slug>` and persistent player profiles. Players do not join `/sessions`, attach maps to sessions, or use session-owned map copies for normal play.
- **Client writes:** clients send explicit domain commands for live gameplay mutations. Clients do not save whole map documents during live gameplay.
- **Actor authority:** each command identifies the acting GM or selected player profile. The server resolves the persisted profile before deciding authority.
- **Validation:** before applying a command, the server validates actor role, selected profile, map visibility, token control, command shape, `baseRevision`, and resource conflicts.
- **Revisions:** accepted commands increment authoritative map and/or sheet revisions. Rejected commands do not advance revisions.
- **Idempotency:** commands are idempotent by client-generated `opId`. Retrying the same `opId` returns the previous accepted/rejected result without applying effects twice.
- **Realtime:** accepted commands broadcast patches or authoritative accepted results. Realtime delivery never asks another client to infer live gameplay state from a browser-owned whole-map save.
- **Persistence:** database-backed persistence is the target for authoritative live play. JSON files remain setup/edit storage, migration input/output, backup/export material, or temporary compatibility storage during the migration.

## Mode split

### Setup/edit mode

Setup/edit mode is the GM-oriented map and sheet preparation workflow. It may continue to use document-oriented JSON saves, debounced autosave, import/export, file repair, and local realtime updates because those workflows are not the live multiplayer concurrency boundary.

Examples include creating maps, editing terrain, setting visibility, creating sheets, organizing libraries, and other GM maintenance tasks before or after play.

### Live play mode

Live play mode is the multiplayer table workflow where a GM and players may act concurrently. Gameplay mutations such as token movement, facing, HP, combat stages, conditions, move usage, initiative, hazards, field effects, terrain changes, token spawn/delete, and sheet-backed action effects flow through server-authoritative commands.

Whole-map browser autosave is forbidden as the live gameplay authority. A full map snapshot may still be written by the server for setup/edit compatibility, migration, backup, or recovery, but live clients must not compete by writing whole map documents over one another.

## Command result rules

A command handler has one of three outcomes:

1. **Accepted:** the server applies the command to authoritative state, persists it, increments the affected revision(s), records the `opId` result, and broadcasts an accepted patch/result.
2. **Rejected:** the server returns a reusable rejection shape such as invalid, unauthorized, stale, or conflict. No revision is incremented.
3. **Duplicate:** the server recognizes the `opId` and returns the previous result or an equivalent duplicate acknowledgement. No effect is applied again and no revision is incremented by the retry itself.

Conflict checks are domain-scoped, not generic JSON merges. A stale token move conflicts with a newer accepted move for the same token; unrelated-resource commands may be accepted only when retained revision/resource metadata proves they are independent.

## Legacy `/sessions` boundary

Legacy `/sessions` pages, routes, socket messages, session snapshots, and session-local identities are archival or maintenance-only. They may remain behind their explicit runtime guard while maintainers need smoke tests for the old surface, but they must not be documented as the normal product path.

Normal play uses persistent player profiles, regular saved-map URLs, server-authoritative command/revision/idempotency contracts, and the profile/token-control policies already used by the map and sheet routes.

## Consequences

- Shared command contracts must be client/server-safe and reusable across routes, executors, tests, and realtime clients.
- API routes should delegate to command services/executors instead of reimplementing envelope, revision, idempotency, or rejection behavior.
- UI code should dispatch commands and reconcile against accepted results, rejections, patches, or revision reconciliation data rather than saving whole documents for live gameplay.
- Setup/edit autosave may remain available, but product docs and source comments must keep it separate from live play authority.
- Database repositories and migration tools must eventually replace JSON files as the authoritative live-play persistence layer.
- Legacy session docs should be labeled historical, archival, or maintenance-only whenever they remain in the repository.

## Rejected alternatives

### Browser-owned whole-map autosave for live play

Rejected. It recreates last-writer-wins overwrites, hides permission checks in client code, makes stale retries ambiguous, and lets a browser replace newer accepted table state.

### Generic collaborative document merging

Rejected. Rotom Table needs tabletop-domain validation: actor, profile, map visibility, token control, sheet access, command-specific invariants, revisions, and resource conflicts.

### Legacy `/sessions` as normal play

Rejected. Normal multiplayer play stays on `/maps/<slug>` with persistent profiles. Session-local join codes, map attachment, and session-owned map copies must not be revived as the normal route.

### Client timestamps as ordering authority

Rejected. Browser clocks and network arrival order are diagnostic only. Server-owned revisions determine accepted state.

## Validation notes

Reviewers can validate this direction by checking that future live-play work:

- routes live gameplay mutations through explicit commands with `opId` and `baseRevision`;
- validates selected profile and token/sheet authority server-side;
- increments revisions only for accepted commands;
- rejects stale or conflicting same-resource commands without advancing revisions;
- broadcasts accepted patches/results rather than whole-map live saves;
- keeps setup/edit autosave separate from live play; and
- labels legacy `/sessions` material as maintenance-only.
