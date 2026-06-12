# Live play authority

This document defines Rotom Table's normal multiplayer direction: server-authoritative profile play on regular `/maps/<slug>` routes.

Normal play uses persistent player profiles. The legacy `/sessions` lobby, join-code flow, session-local socket identity, and session snapshots are maintenance-only while that surface remains in the codebase.

## Non-negotiable boundary

Browser-owned whole-map autosave is forbidden as the authority for live gameplay.

A browser may use document autosave during GM setup/edit workflows, local maintenance, or temporary compatibility flows. During live play, clients send explicit commands. The server accepts or rejects those commands after validating the actor, profile, map visibility, token/sheet authority, command shape, `baseRevision`, and conflicts. Accepted commands advance authoritative revisions and broadcast patches or accepted results.

## Mode split

### Setup/edit mode

Setup/edit mode is map and sheet preparation or maintenance. It includes GM map building, terrain edits, library organization, visibility setup, sheet edits, imports/exports, and local data repair. Whole-document JSON saves and debounced autosave may remain in this mode because a GM/operator is preparing campaign data rather than resolving concurrent live table actions. The map save route requires an explicit `interactionMode: "setup-edit"` marker and GM role for whole-map saves.

### Live play mode

Live play mode is the multiplayer table state that players and the GM act on together. It uses persistent player profiles and regular `/maps/<slug>` URLs. Gameplay mutations are commands such as move token, turn token, modify HP, use move, advance initiative, place a hazard, edit terrain, spawn/delete token, or update sheet-backed combat state.

Live play commands must be server-authoritative. A client can optimistically preview an action, but the accepted server result, rejection, patch, or reconciliation response determines durable state. Live play mode does not deep-watch the map document and does not call `/api/maps/save`; player requests and explicit `interactionMode: "live-play"` requests to that route are rejected.

## Command flow

1. The client creates a command envelope with a unique `opId`, the current `baseRevision`, actor/profile context, command type, resource scope, and command-specific payload.
2. The server resolves the role and selected persistent profile, then validates map visibility and token/sheet control.
3. The server validates command shape and command-specific invariants.
4. The server compares `baseRevision` and resource scope against current authoritative state and recent accepted changes.
5. If valid and non-conflicting, the server applies the command, persists the result, increments affected revisions, stores the `opId` result, and broadcasts the accepted patch/result.
6. If invalid, unauthorized, stale, or conflicting, the server rejects the command without advancing revisions.
7. If retried with the same `opId`, the server returns the stored result without applying effects twice.

Idempotency records are keyed by map and `opId`. Each record stores the accepted or rejected result plus a deterministic hash of the normalized command envelope. A retry with the same map, `opId`, and command body returns the stored result without advancing map or sheet revisions. Reusing the same map/`opId` for a different command body is rejected as an idempotency conflict and does not replace the original record.

Server command routes use the authoritative live-play command executor as the cross-cutting pipeline for envelope validation, actor resolution, duplicate `opId` checks, per-map write queueing, revision validation, authorization, conflict hooks, pure command application, persistence, idempotency-result storage, and realtime patch publishing. Token move and token turn on normal map play now use this path for both GM and player actions: the client sends `moveToken` or `turnToken` with `opId`, `baseRevision`, token scope, and selected profile context when applicable; the server reads and updates the accepted map revision through the SQLite map repository before broadcasting revisioned map and command events. The map page defaults to live-play mode, so these command-backed movement and facing actions do not rely on whole-map autosave. The initial queue is in-process: commands targeting the same map run sequentially, while commands targeting different maps can continue independently. Persistence or idempotency-storage failures return structured rejections and must not publish success patches.

HP, injury, combat-stage, and condition controls in live play use `modifyHp`, `modifyCombatStages`, and `modifyConditions` command envelopes. The server resolves the placement's backing sheet, checks GM authority or selected-profile token control, applies the same sheet normalization helpers used by setup/edit flows, writes the map revision, sheet revision, and `opId` result transactionally through SQLite, then broadcasts map, sheet, and accepted-command events. The client adopts the returned authoritative map and sheet update; live-play controls do not post `/api/sheets/save`.

Move usage in live play uses the `useMove` command envelope with `placementId` and `moveName` in the payload. The server resolves the placed token and backing sheet, determines the move frequency, records EOT and Scene usage on the authoritative map document, records Daily usage on the authoritative sheet document, records untracked move use as an ordered map combat-log action, persists the affected map/sheet revisions and `opId` result through the live-play executor, and returns token and/or sheet patches. The map page dispatches this command and adopts the returned authoritative map and sheet updates instead of splitting move usage into local map usage saves and direct sheet usage saves.

Initiative management in live play uses GM-only `setInitiative`, `nextInitiative`, and `previousInitiative` command envelopes with the map initiative scope. The server validates token IDs, initiative values, active combatant IDs, and rounds, rejects player commands, advances the authoritative map revision for accepted changes, stores the `opId` result, and returns a `map.initiative` patch containing the previous and current initiative lane. The map page dispatches these commands for live-play initiative controls instead of mutating map initiative locally and waiting for whole-map autosave.

Hazards and field effects in live play use GM-only `placeHazard`, `removeHazard`, `setFieldEffect`, `removeFieldEffect`, and `tickFieldEffectDurations` command envelopes with the map hazards or field-effects scope. The server validates map bounds, hazard kind and layers, field-effect category/kind/duration options, no-op requests, stale revisions, and player rejection before persisting a new map revision. Accepted hazard commands return `map.hazards` patches with the previous and current cell state; accepted field-effect commands return `map.fieldEffects` patches with the previous and current field-effects lane. The map page dispatches these commands for live-play hazard and field-effect controls instead of relying on whole-map autosave.

Commands that update both map state and sheet-backed state must use the executor's accepted-result commit hook with the SQLite map, sheet, and operation repositories inside one database transaction. The command result is stored in the same transaction as the map/sheet revisions, so stale or failed commands roll back all durable changes and duplicate `opId` retries cannot apply HP, condition, combat-stage, daily move usage, ability, or capture sheet effects twice.

## Shared command contract

`shared/livePlayCommands.ts` is the canonical client/server-safe contract for live-play command envelopes, command type constants, patch type constants, resource scopes, `opId`/`baseRevision`/map slug validators, and reusable accepted/rejected/duplicate result builders. Command routes and client dispatchers should import these definitions instead of inventing local request or rejection shapes.

## Persistence direction

Persisted map and sheet documents carry a server-owned numeric `revision`. Legacy JSON documents that do not yet contain a revision load as revision `0`, and saves keep `updatedAt` only for display/sorting metadata rather than command conflict control. Accepted map-affecting commands advance the map revision once; accepted sheet-backed commands advance the affected sheet revision once; no-op or rejected commands do not advance revisions.

Database-backed persistence is the target for authoritative live play. The storage foundation uses Node 24's built-in `node:sqlite` module rather than an added native package, keeps SQL behind server-side repository modules, and migrates deterministically on first database access. The default database path is `rotom-table.sqlite` under `ROTOM_CAMPAIGN_ROOT`; operators can override it with `ROTOM_DB_PATH`, for example `/srv/rotom-table/campaign/rotom-table.sqlite`. File-backed databases enable WAL mode, and the initial schema stores map documents, sheet documents, and live-play operation results with revisions.

The map repository stores normalized map documents with explicit revision and `updatedAt` columns. `server/storage/importMapsFromJson.ts` can import existing `data/maps/**/*.json` documents into SQLite idempotently, deriving folders from the JSON file path, preserving map metadata, preserving existing revisions, and defaulting older documents to revision `0`. Live-play token move and token turn commands use the repository's revision-checked update path; a stale expected revision returns without overwriting the newer row.

The sheet repository stores Pokémon and trainer sheet documents with explicit revision and `updatedAt` columns. `server/storage/importSheetsFromJson.ts` can import existing `data/sheets/**/*.json` and `data/trainers/**/*.json` documents into SQLite idempotently, preserving sheet revisions, deriving folders for import reporting, and defaulting older documents to revision `0`. Live-play sheet-backed commands must update sheets through the repository's revision-checked update path inside the same transaction as any map update and accepted command result.

JSON files remain useful for setup/edit storage, local data inspection, backups, exports, migration source/target artifacts, and temporary compatibility during the migration. Current JSON-backed setup and library routes continue to run until the relevant map and sheet repositories are fully migrated. `/api/sheets/save` is a setup/edit sheet editing endpoint and requires explicit setup/edit mode; live map combat sheet mutations must use command routes instead of direct whole-sheet saves. JSON file writes must not be treated as concurrent live gameplay authority.

## Realtime direction

Realtime messages for live play are authoritative accepted results, patches, or reconciliation responses. Map-scoped realtime events carry a numeric `revision`; accepted command events use `live-play-command-accepted` with `previousRevision`, `opId`, and `patches`. Clients ignore stale revisions, detect gaps between their current map revision and incoming events, and reload the authoritative `/api/maps/load?slug=<slug>` snapshot when replay is not available.

The map page exposes the current map revision for command `baseRevision` values. During SSE reconnect and reconciliation, live-play commands are paused and a visible status notice is shown; once the authoritative map reload completes, command dispatch resumes from the reconciled revision.

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
