# Live play authority

This document defines Rotom Table's normal multiplayer direction: server-authoritative profile play on regular `/maps/<slug>` routes.

Normal play uses persistent player profiles. The legacy `/sessions` lobby, join-code flow, session-local socket identity, and session snapshots are maintenance-only while that surface remains in the codebase.

## Non-negotiable boundary

Browser-owned whole-map autosave is forbidden as the authority for live gameplay.

A browser may use document autosave during GM setup/edit workflows, local maintenance, or temporary compatibility flows. During live play, clients send explicit commands. The server accepts or rejects those commands after validating the actor, profile, map visibility, token/sheet authority, command shape, `baseRevision`, and conflicts. Accepted commands advance authoritative revisions and broadcast patches or accepted results.

## Mode split

### Setup/edit mode

Setup/edit mode is map and sheet preparation or maintenance. It includes GM map building, terrain edits, library organization, visibility setup, sheet edits, imports/exports, and local data repair. Whole-document JSON saves and debounced autosave may remain in this mode because a GM/operator is preparing campaign data rather than resolving concurrent live table actions.

### Live play mode

Live play mode is the multiplayer table state that players and the GM act on together. It uses persistent player profiles and regular `/maps/<slug>` URLs. Gameplay mutations are commands such as move token, turn token, modify HP, use move, advance initiative, place a hazard, edit terrain, spawn/delete token, or update sheet-backed combat state.

Live play commands must be server-authoritative. A client can optimistically preview an action, but the accepted server result, rejection, patch, or reconciliation response determines durable state.

## Command flow

1. The client creates a command envelope with a unique `opId`, the current `baseRevision`, actor/profile context, command type, resource scope, and command-specific payload.
2. The server resolves the role and selected persistent profile, then validates map visibility and token/sheet control.
3. The server validates command shape and command-specific invariants.
4. The server compares `baseRevision` and resource scope against current authoritative state and recent accepted changes.
5. If valid and non-conflicting, the server applies the command, persists the result, increments affected revisions, stores the `opId` result, and broadcasts the accepted patch/result.
6. If invalid, unauthorized, stale, or conflicting, the server rejects the command without advancing revisions.
7. If retried with the same `opId`, the server returns the stored result without applying effects twice.

Idempotency records are keyed by map and `opId`. Each record stores the accepted or rejected result plus a deterministic hash of the normalized command envelope. A retry with the same map, `opId`, and command body returns the stored result without advancing map or sheet revisions. Reusing the same map/`opId` for a different command body is rejected as an idempotency conflict and does not replace the original record.

## Shared command contract

`shared/livePlayCommands.ts` is the canonical client/server-safe contract for live-play command envelopes, command type constants, patch type constants, resource scopes, `opId`/`baseRevision`/map slug validators, and reusable accepted/rejected/duplicate result builders. Command routes and client dispatchers should import these definitions instead of inventing local request or rejection shapes.

## Persistence direction

Persisted map and sheet documents carry a server-owned numeric `revision`. Legacy JSON documents that do not yet contain a revision load as revision `0`, and saves keep `updatedAt` only for display/sorting metadata rather than command conflict control. Accepted map-affecting commands advance the map revision once; accepted sheet-backed commands advance the affected sheet revision once; no-op or rejected commands do not advance revisions.

Database-backed persistence is the target for authoritative live play. The database layer should provide transactional document/state writes, revision updates, idempotency records, and migration support.

JSON files remain useful for setup/edit storage, local data inspection, backups, exports, migration source/target artifacts, and temporary compatibility during the migration. JSON file writes must not be treated as concurrent live gameplay authority.

## Realtime direction

Realtime messages for live play are authoritative accepted results, patches, or reconciliation responses. Missed events are resolved through revision reconciliation: replay when retained history proves it is safe, otherwise fetch a current authoritative snapshot/state response.

Realtime must not rely on every browser saving or receiving whole map documents as a last-writer-wins conflict strategy.

## Legacy `/sessions` boundary

Documents and code with `session` or `/sessions` names describe the legacy guarded session-local surface unless they explicitly say otherwise. That surface may stay available for direct maintenance and smoke checks behind its runtime guard, but it is not normal profile play.

Normal profile play has no join code, map attachment step, session-owned map copy, share link, invite link, or per-map invite. Players choose a persistent profile and open player-visible maps through the normal app navigation.

## Glossary

| Term | Meaning |
| --- | --- |
| Setup/edit mode | GM/operator preparation and maintenance workflow where whole-document JSON saves and debounced autosave may be used for maps, sheets, libraries, imports, exports, and repairs. |
| Live play mode | Multiplayer table workflow on `/maps/<slug>` where the GM and players mutate gameplay state through server-authoritative commands. |
| Command | An explicit client request for a domain state change, such as moving a token, changing HP, using a move, or advancing initiative. |
| `opId` | Client-generated operation identifier used by the server to recognize retries and return idempotent results without applying an effect twice. |
| `baseRevision` | The authoritative revision the client observed when it created a command. The server uses it to detect stale or conflicting commands. |
| Map revision | Server-owned monotonic revision for authoritative map state. Accepted map-affecting commands advance it; rejected commands do not. |
| Sheet revision | Server-owned monotonic revision for authoritative sheet-backed gameplay state. Accepted sheet-affecting commands advance it; rejected commands do not. |
| Patch | Small realtime payload that describes an accepted authoritative change without broadcasting a client-owned whole map or whole sheet save as the live authority. |
| Stale command | A command whose `baseRevision` is older than the current authoritative revision. It may be rejected, or accepted only when retained resource-scope history proves it is independent and still authorized. |
| Conflict | A valid-looking command that cannot safely apply because current authoritative state or recent accepted changes touched the same or incompatible resource scope. |
| Idempotent retry | Resending the same command with the same `opId`; the server returns the previous result or duplicate acknowledgement without applying effects again or advancing a revision for the retry. |
