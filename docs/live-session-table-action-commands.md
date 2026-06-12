# Legacy live-session table action command reference

This guide documents server-authoritative table action commands for the guarded legacy `/sessions` socket implementation. It is retained for maintainers of HP, combat-stage, condition, move/action, initiative, hazard, field-effect, and terrain command flows while that surface exists.

Normal multiplayer play uses persistent player profiles on regular `/maps/<slug>` routes and follows [Live play authority](live-play-authority.md). Do not use this legacy session command reference to route normal profile play back through `/sessions`.

The legacy architecture remains the locked Live session model: a GM-hosted local server, explicit session-host runtime flag, WebSocket command transport, session-local identity, server-owned revisions, local JSON snapshots, and small same-session patches instead of live-client whole-map autosaves.

## Common command flow

All commands in this guide use the shared session command envelope:

- `schemaVersion: 1`
- `sessionId`
- authenticated `actor` metadata from the WebSocket hello path
- command `type`
- unique `opId`
- observed `baseRevision`
- command-specific `scopes`
- command-specific `payload`

The live transport is `WebSocket /api/sessions/socket`, and it is unavailable unless `ROTOM_ENABLE_SESSION_HOST=1` is set. The server validates the socket identity before dispatching any command; the `actor` field in the envelope is audit metadata, not public authentication.

For each accepted table action command, the server:

1. validates the common envelope and command-specific payload;
2. checks the authenticated actor against current GM/player assignments;
3. resolves the current authoritative map, token, sheet, or map lane;
4. rejects invalid, unauthorized, stale, no-op, or conflict cases without advancing revisions;
5. applies the mutation to server-owned state, and to sheet JSON when a sheet-backed command requires it;
6. increments the session revision and affected map revision exactly once;
7. writes an atomic session snapshot, rolling back in-memory and sheet changes if snapshot persistence fails;
8. records the `opId` result for idempotent duplicate retries;
9. sends a `commandAck` or `commandReject` to the sender; and
10. broadcasts a small `patch` frame only to authenticated clients in the same session.

Rejected and duplicate commands do not advance revisions. Accepted patches never fan out a whole map document or whole sheet file.

## Supported command inventory

### Sheet-backed token and sheet state

These commands target a placed token and its backing Pokémon or trainer sheet. Players may use them only when the GM has assigned the relevant visible token or matching sheet as controllable. The server resolves the actual placement and sheet from authoritative state; payload IDs and scopes are not trusted by themselves.

| Command | Payload summary | Required scopes | Permission | Accepted effect | Patch event | Common rejects |
| --- | --- | --- | --- | --- | --- | --- |
| `modifyHp` | `tokenId`, absolute `currentHp`, optional absolute `injuries` | token scope with `field: "hp"`; optional matching sheet `hp` scope | GM or assigned visible token/sheet controller | Applies existing HP/Injury mutation rules to the backing sheet, persists the sheet and session snapshot, and advances revisions | `hpModified` with `previous` and `current` HP state | invalid HP/Injuries, missing map/token/sheet, unauthorized player, stale same-resource HP, snapshot/write rollback |
| `modifyCombatStages` | `tokenId`, full absolute `stages` map for `atk`, `def`, `satk`, `sdef`, `spd`, `acc` in `-6..6` | token scope with `field: "combatStages"`; optional matching sheet scope | GM or assigned visible token/sheet controller | Applies the full combat-stage map to the backing sheet, persists the sheet and snapshot, and advances revisions | `combatStagesModified` with full `previous` and `current` stage maps | invalid stage set, missing target, unauthorized player, stale same-resource stages, snapshot/write rollback |
| `modifyConditions` | `tokenId`, action `add`/`remove`/`replace`, `conditions` list | token scope with `field: "conditions"`; optional matching sheet scope | GM or assigned visible token/sheet controller | Normalizes and applies condition add/remove/replace semantics; `replace` may clear with an empty list | `conditionsModified` with `previous` and `current` condition lists | invalid action/list, missing target, unauthorized player, stale same-resource conditions, snapshot/write rollback |

Notes:

- `modifyHp` uses an absolute current HP request. Existing sheet mutation rules cap normal healing while preserving overkill where the app already does so.
- `modifyCombatStages` replaces all six tracked stages in one authoritative command rather than applying partial client-side diffs.
- `modifyConditions` treats condition names as player-safe strings and normalizes through the same sheet condition helpers used by local mode.

### Move, maneuver, ability, and order boundaries

These commands route table action usage through the session command boundary while preserving existing move/action automation where implemented. They do not attempt to become a complete PTU rules engine; they record or apply the automation already modeled by Rotom Table.

| Command | Payload summary | Required scopes | Permission | Accepted effect | Patch event | Common rejects |
| --- | --- | --- | --- | --- | --- | --- |
| `useMove` | `tokenId`, `moveName` | token scope with `field: "moveUsage"`; optional matching sheet scope | GM or assigned visible token/sheet controller | Resolves the move on the placed sheet; tracks EOT/Scene usage in authoritative map state, Daily usage in the sheet file, and untracked frequencies as ordered session events | `moveUsed` with frequency, tracking mode, previous usage, and current usage | move not found, frequency unavailable, unauthorized player, stale same move-usage resource, sheet/snapshot rollback |
| `useManeuver` | `tokenId`, `maneuverName`, optional `targetTokenId` | token scope with `field: "maneuver"`; optional matching sheet scope | GM or assigned visible token/sheet controller | Resolves the maneuver option and appends authoritative maneuver log metadata to the map | `maneuverUsed` with actor/target labels and log lines | maneuver unavailable, missing required target context, unauthorized player, stale same-action resource |
| `useAbility` | `tokenId`, `abilityName`, optional `targetTokenId` | token scope with `field: "ability"`; optional matching sheet scope | GM or assigned visible token/sheet controller | Resolves the ability, rejects passive/no-boundary abilities, applies supported sheet or map ability automation, and logs the action | `abilityUsed` with category, activation flag, combat-stage/condition updates, and log lines | ability missing, passive, no Live session automation boundary, required target missing, referenced target unavailable, unauthorized or stale |
| `useOrder` | `tokenId`, `orderName`, optional `targetTokenId` | token scope with `field: "order"`; optional matching sheet scope | GM or assigned visible trainer token/sheet controller | Requires a trainer token, resolves the order, appends order log metadata, and adds active-order effect metadata when applicable | `orderUsed` with trainer, target, active effect, and log lines | non-trainer token, order unavailable, required target missing, unauthorized player, stale same-action resource |

Notes:

- `useMove` preserves local move-frequency semantics: EOT/Scene tracking is map-scoped, Daily tracking is sheet-scoped, and untracked frequencies are accepted as ordered session events.
- `useAbility` intentionally rejects abilities without an active Live session automation boundary. That fail-closed behaviour prevents clients from claiming unsupported automation applied.
- `useOrder` is trainer-only. Pokémon tokens cannot issue order commands even if a malformed client sends the envelope.

### GM-only map lanes

The following commands are GM-only in Live session. Player actors are rejected even if they can see the map.

| Command | Payload summary | Scope lane/field | Accepted effect | Patch event | Common rejects |
| --- | --- | --- | --- | --- | --- |
| `setInitiative` | optional `mapSlug`; one or more of `initiative` for `tokenId`, `activeId`, or `round` | `lane: "initiative"`, `field: "initiative"` | Sets or clears a token initiative override, active turn, and/or 1-based round counter | `initiativeUpdated` with previous/current lane and changed token IDs | player actor, invalid round or initiative, missing map/token, stale initiative lane, no-op |
| `nextInitiative` / `previousInitiative` | optional `mapSlug` | `lane: "initiative"`, `field: "initiative"` | Advances or rewinds the active initiative turn using authoritative map entries and round state | `initiativeUpdated` | player actor, missing map, empty/no-op initiative lane, stale initiative lane |
| `placeHazard` | optional `mapSlug`; `hazard` cell with kind, optional Toxic Spikes `layer`, optional `owner` | `lane: "hazard"`, `field: "hazards"` | Places or layers a supported hazard on one cell | `hazardsUpdated` with previous/current cell hazards plus `placed` | player actor, unsupported kind, out-of-bounds cell, no-op duplicate, stale hazard lane |
| `removeHazard` | optional `mapSlug`; `cell` and optional `kind` | `lane: "hazard"`, `field: "hazards"` | Removes one hazard kind from a cell, or all hazards on that cell when `kind` is omitted | `hazardsUpdated` with removed hazards and current cell hazards | player actor, out-of-bounds cell, missing target/no-op, stale hazard lane |
| `setFieldEffect` | optional `mapSlug`; category `weather`, `terrain`, or `room`; kind; optional `rounds`, `source`, `weatherMode`, `terrainScope`, `startsNextRound` | `lane: "field-effect"`, `field: "fieldEffects"` | Sets a Weather/Terrain/Room effect; `rounds: 0` removes that kind; weather replaces by default or appends a bounded second weather with `weatherMode: "append"` | `fieldEffectsUpdated` with previous/current field effects | player actor, mismatched kind/category, no-op, missing map, stale field-effect lane |
| `removeFieldEffect` | optional `mapSlug`; category `weather`, `terrain`, `room`, or `all`; optional kind | `lane: "field-effect"`, `field: "fieldEffects"` | Removes one kind, a whole category, or all field effects | `fieldEffectsUpdated` | player actor, missing/no active effect, missing map, stale field-effect lane |
| `tickFieldEffectDurations` | optional `mapSlug`; optional positive `amount` (default `1`) | `lane: "field-effect"`, `field: "fieldEffects"` | Decrements finite durations and removes expired effects; `null` or absent duration is sustained | `fieldEffectsUpdated` with `tickAmount` | player actor, invalid amount, no finite durations changed, stale field-effect lane |
| `buildTerrainVoxel` | optional `mapSlug`; `voxel` cell, `materialId`, optional color/ghost/blocking/tags | `lane: "terrain"`, `field: "voxel:x,y,z"` | Builds or replaces one voxel using terrain-builder material/default-colour rules | `terrainVoxelsUpdated` with previous/current cell voxel and renderer invalidation reasons | player actor, out-of-bounds cell, occupied token cell, unbuildable material, no-op, stale same-cell edit |
| `removeTerrainVoxel` | optional `mapSlug`; `cell` | `lane: "terrain"`, `field: "voxel:x,y,z"` | Removes one voxel from a cell | `terrainVoxelsUpdated` with removed voxel and renderer invalidation reasons | player actor, missing voxel/no-op, out-of-bounds cell, stale same-cell edit |

Supported hazard kinds are `spikes`, `toxic-spikes`, `sticky-web`, `stealth-rock`, and `fire`. Toxic Spikes supports layers `1` and `2`; other hazard kinds ignore layer after validation/normalization.

Supported field-effect kinds are:

- Weather: `sunny`, `rainy`, `hail`, `sandstorm`
- Terrain: `electric`, `grassy`, `misty`, `psychic`
- Room: `magic`, `trick`, `wonder`

Terrain patches include the renderer invalidation reasons `terrain`, `movement-preview`, `build-preview`, and `hazard-preview` so session-map client integration preserves existing scene refresh behaviour.

## Permission matrix

| Command family | GM | Player |
| --- | --- | --- |
| HP, combat stages, conditions | Allowed after normal validation | Allowed only for GM-assigned visible token or matching sheet resources |
| Move usage, maneuvers, abilities, orders | Allowed after normal validation | Allowed only for GM-assigned visible token or matching sheet resources; order still requires a trainer token |
| Initiative | Allowed | Rejected with GM-required authorization failure |
| Hazards | Allowed | Rejected with GM-required authorization failure |
| Field effects | Allowed | Rejected with GM-required authorization failure |
| Terrain voxels | Allowed | Rejected with GM-required authorization failure |

Player authorization is always checked against the current server-side assignment record. Display names, client-supplied actor objects, hidden resources, or stale browser state do not grant control.

## Conflict and revision rules

The table action commands follow the Live session conflict model:

- Duplicate `opId` retries return the original accepted or rejected result idempotently.
- Accepted commands increment the session revision and affected map revision once.
- Invalid, unauthorized, stale, conflict, no-op, and snapshot-failure outcomes do not advance revisions.
- Stale same-resource commands return a safe `currentState` snapshot where the handler has one, so rejection UI can reconcile from the authoritative value.
- Commands on unrelated resources may apply across small revision gaps only when the handler can prove the touched scopes do not overlap. Terrain explicitly allows tracked disjoint-cell edits across a small revision gap; same-cell edits stay stale-rejected.
- GM commands are not raw overrides. They generally win over player permission boundaries, but still pass shape, map bounds, target existence, no-op, stale, and persistence checks.
- Sheet-backed commands write the sheet first and then the session snapshot; if the snapshot write fails, the handler rolls the sheet and in-memory state back to the previous value.

Current same-resource conflict lanes are:

| Lane | Commands |
| --- | --- |
| token/sheet `hp` | `modifyHp` |
| token/sheet `combatStages` | `modifyCombatStages` |
| token/sheet `conditions` | `modifyConditions` |
| token/sheet `moveUsage` | `useMove` |
| token/sheet action fields | `useManeuver`, `useAbility`, `useOrder` |
| map `initiative` lane | `setInitiative`, `nextInitiative`, `previousInitiative` |
| map `hazards` lane | `placeHazard`, `removeHazard` |
| map `fieldEffects` lane | `setFieldEffect`, `removeFieldEffect`, `tickFieldEffectDurations` |
| terrain cell `voxel:x,y,z` | `buildTerrainVoxel`, `removeTerrainVoxel` |

## Patch broadcast reference

Accepted commands broadcast these small event types to same-session clients:

| Event type | Carries |
| --- | --- |
| `hpModified` | token/sheet identity plus previous/current HP and Injuries |
| `combatStagesModified` | token/sheet identity plus previous/current full stage maps |
| `conditionsModified` | token/sheet identity plus previous/current condition lists |
| `moveUsed` | token/sheet identity, move name/key, frequency, tracking mode, previous/current usage |
| `maneuverUsed` | acting token, optional target, resolved maneuver name, log lines |
| `abilityUsed` | acting token, optional target, ability category, sheet activation, combat-stage/condition updates, log lines |
| `orderUsed` | trainer token, optional target, active order effect, log lines |
| `initiativeUpdated` | map slug, command type, previous/current initiative lane, changed token IDs |
| `hazardsUpdated` | map slug, cell, previous/current hazards, placed/removed hazards |
| `fieldEffectsUpdated` | map slug, command type, previous/current field effects, category/kind/tick summary |
| `terrainVoxelsUpdated` | map slug, cell, previous/current voxel, built/removed voxel, renderer invalidation reasons |

Patch payloads are intentionally narrow. Clients that need a full recovery after missed patches should use reconnect snapshot fallback instead of assuming patch events can replay the whole session.

## Current limitations and migration notes

- The server and WebSocket command boundaries remain covered by focused tests for legacy maintenance, but the old client session-map command helpers and explicit session-map UI have been removed. Normal map play uses profile-derived document-backed APIs instead of this legacy command client.
- Legacy local mode still uses filesystem-backed JSON saves and legacy SSE where applicable. Remaining server-side session command tests must stay isolated from normal profile-based map play.
- This is not public authentication. The existing local role picker remains a trust switch, while Live session commands rely on the session-host flag, hello/auth handshake, GM key, join code, player IDs, client IDs, and server-side assignments.
- The optional event log is not a full replay guarantee in Live session. Reconnect remains snapshot-safe when replay is unavailable.
- Ability automation is deliberately limited to known active/session-safe boundaries. Passive abilities or abilities without a Live session automation boundary reject instead of pretending automation happened.
- Hazard, field-effect, and terrain commands mutate the map lanes they own; they do not calculate all downstream PTU effects such as damage, visibility, or movement rules by themselves.
- Terrain commands preserve map render invalidation expectations, and session-map client integration applies terrain patch events to the session-authoritative map clone.
- Session persistence remains local JSON snapshots and sheet files; no database, SaaS service, Quick Tunnel-first deployment, or generic collaborative-document model is introduced.

## Validation coverage

The table-action command flows are covered by focused shared-contract, server-use-case, and WebSocket dispatch tests, including:

- `tests/shared/sessionTableActionCommands.test.ts`
- `tests/shared/sessionInitiativeCommands.test.ts`
- `tests/shared/sessionHazardCommands.test.ts`
- `tests/shared/sessionFieldEffectCommands.test.ts`
- `tests/shared/sessionTerrainCommands.test.ts`
- `tests/server/applyModifyHpCommand.test.ts`
- `tests/server/applyModifyCombatStagesCommand.test.ts`
- `tests/server/applyModifyConditionsCommand.test.ts`
- `tests/server/applyUseMoveCommand.test.ts`
- `tests/server/applyUseTableActionCommand.test.ts`
- `tests/server/applyInitiativeCommand.test.ts`
- `tests/server/applyHazardCommand.test.ts`
- `tests/server/applyFieldEffectCommand.test.ts`
- `tests/server/applyTerrainCommand.test.ts`
- `tests/server/sessionModifyHpWebSocketDispatch.test.ts`
- `tests/server/sessionModifyCombatStagesWebSocketDispatch.test.ts`
- `tests/server/sessionModifyConditionsWebSocketDispatch.test.ts`
- `tests/server/sessionUseMoveWebSocketDispatch.test.ts`
- `tests/server/sessionUseTableActionWebSocketDispatch.test.ts`
- `tests/server/sessionInitiativeWebSocketDispatch.test.ts`
- `tests/server/sessionHazardWebSocketDispatch.test.ts`
- `tests/server/sessionFieldEffectWebSocketDispatch.test.ts`
- `tests/server/sessionTerrainWebSocketDispatch.test.ts`

For the surrounding transport and storage details, see the [live session protocol](live-session-protocol.md), [Live session socket protocol](live-session-socket-protocol.md), and [live session storage](live-session-storage.md) guides.
