# Live-play batch workflow audit

This audit records the live-play workflows that still make multiple authoritative requests for one table intention, plus the adjacent multi-resource actions that should share Sprint 4 batch semantics. It began as a descriptive audit; implementation notes are kept current as Sprint 4 tickets land.

## Batch selection rules

Sprint 4 should batch only explicit, bounded, server-authoritative operations. A batch candidate is valuable when all of these are true:

- the UI presents the work as one user intention, or users naturally repeat the same edit as one brush/cleanup action;
- every affected resource can be named up front and bounded before dispatch;
- the server can validate role/profile authority, map visibility, bounds, revision, and conflict scopes before mutating state;
- accepted effects can be committed in one SQLite transaction with durable realtime rows appended before commit;
- retrying the same `opId` and exact command body can return the stored terminal result without duplicating effects;
- rejected/stale/conflicting/invalid payloads can fail the whole operation without partial writes;
- local prediction is either already safe and narrow, or the UI can show pending/recovery state without pretending the client is authoritative.

## Shared Sprint 4 guardrails

Batch contracts use shared, side-effect-free validators from `shared/livePlayBatchCommands.ts` before any server mutation path can run. The initial guardrail limits are:

- hazard cell batches: at most 128 cells;
- terrain voxel batches: at most 256 voxels/cells;
- field-effect operation batches: at most 16 operations;
- affected-token summaries/scopes: at most 64 token ids.

Unique grid-cell helpers reject duplicate cells by default so mixed add/remove contracts cannot hide contradictory operations. Idempotent clear-style contracts may opt into duplicate normalization, which preserves the first occurrence and drops later repeats. Strict object parsing rejects unknown durable-state fields instead of carrying private/profile/debug data through batch payloads.

The first batch contract, `clearHazards`, supports `all`, `cells`, and `kind` payload modes. `all` and `kind` use the conservative map `hazards` lane scope; `cells` uses bounded, normalized explicit hazard-cell scopes so unrelated cell batches can remain independent while still conflicting with broad hazard-lane clears. The batch is exposed through `POST /api/maps/hazards/clear` and must return a terminal live-play command result whose operation ID, map slug, command type, patch type, and patch scopes validate against the submitted command body.

The shared `clearFieldEffects` contract supports category-only clears for `weather`, `terrain`, `room`, and `all`, plus bounded explicit `kinds` lists for one non-`all` category. Empty, duplicate, unknown, cross-category, or over-limit kind lists reject before server mutation. All `clearFieldEffects` modes intentionally use the conservative map `fieldEffects` lane scope so they conflict with set/remove/tick field-effect commands but not unrelated token movement.

## Summary classification

| Workflow | Current live-play behavior | Classification | Why |
| --- | --- | --- | --- |
| Clear all hazards from the map menu | Since LP-S4-007, live play confirms once and sends one `clearHazards` batch command; setup/edit still clears local setup state. | **Sprint 4** | High-friction GM cleanup, deterministic map-lane mutation, no hidden/random state, and previously N requests for one confirmed action. |
| Clear all/weather/terrain/room field effects | Already sends one `removeFieldEffect` command for category/all clears. | **Sprint 4** | Not currently an N-request loop, but it is a multi-resource clear action that should use an explicit clear batch contract, bounded summaries, and batch recovery labels. |
| Repeated terrain voxel edits | Each live-play terrain click sends one `buildTerrainVoxel` or `removeTerrainVoxel` command. | **Sprint 4** | Brush-like terrain edits are common, bounded by cells, deterministic, and already have precise terrain-cell patches. |
| Repeated hazard cell edits | Each live-play hazard click sends one `placeHazard` or `removeHazard` command. | **Sprint 4** | Hazard brush strokes map cleanly to bounded add/remove cell operations and should conflict with clear-hazards/single-hazard edits. |
| Fill initiative from Speed / clear initiative values | Loops over placements and sends `setInitiative` repeatedly, then may reset active/round. | **Later** | It is a real N-request cleanup, but it touches token initiative, active turn, round, and initiative log/metadata rules; this sprint is focused on map effects/brushes first. |
| Advance/previous initiative | Already one `nextInitiative` or `previousInitiative` command. | **Not worth batching** | The server already treats one click as one authoritative transaction with initiative and metadata scopes. |
| Start/end scene | Already one `setScene` command. | **Not worth batching** | Scene start/end has a single map-scene mutation and no repeated command loop. |
| Clear combat log | Setup/edit-only local metadata cleanup. | **Not a live-play batch target** | The current handler is guarded to setup/edit mode, so it is outside live-play command batching. |
| Move automation resolution | Normal live play dispatches one `resolveMove` command. Legacy fallback applies individual updates only when authoritative dispatch is unavailable/setup-like. | **Not worth batching for Sprint 4** | `resolveMove` is already the server-authoritative batch for move effects; do not replace it with a generic macro command. |
| Ability, maneuver, and order use | Each use sends one table-action command; follow-up prompts may send small targeted sheet commands. | **Later / not worth batching** | The primary action is already one command. Reaction prompts are conditional and sheet/token-specific rather than repeated map cleanup. |

## Detailed workflow audit

### 1. Clear all hazards

- **Current UI path:** `src/pages/maps/[slug].vue` `clearAllHazardsFromMenu` confirms once, keeps setup/edit mode on the local `clearAllHazards()` path, and dispatches one live-play `livePlayCommands.clearHazards({ mode: 'all' })` request.
- **Current command route(s):** menu cleanup calls `POST /api/maps/hazards/clear` via `MAP_API_PATHS.clearHazards`; single-cell hazard erasing still uses `POST /api/maps/hazards/remove` via `MAP_API_PATHS.removeHazard`.
- **Current command type:** `clearHazards` for clear-all menu cleanup.
- **Current payload:** `{ mode: 'all' }`.
- **Current command scopes:** `[{ kind: 'map', lane: 'hazards' }]`.
- **Authority scope:** GM-only map-effect authority. Setup/edit mode uses local map mutation and must remain unchanged. Server validation checks command shape, hazard kind, map revision/conflict state, and map bounds.
- **Likely batch conflict scopes:**
  - clear-all and clear-by-kind modes conflict with the broad map `hazards` lane;
  - explicit-cell mode uses precise hazard-cell descriptors for each bounded cell;
  - explicit-cell descriptors still conflict with broad hazard clears and with single/batch hazard edits that use the broad map `hazards` lane.
- **Current accepted patch shape:** one accepted terminal result with a `map.hazards` patch describing the clear mode, previous hazards, removed hazards, and final authoritative hazards list. The route response may also include the full authoritative hazards list/map.
- **Expected batch patch shape:** continue using a `map.hazards` patch that describes removed cells/kinds and the final authoritative hazards list or per-cell final states, precise enough for clients to reconcile without whole-map replacement.
- **Local prediction safety:** not currently predicted. Keep batch hazard cleanup authoritative/pending-only; do not clear local hazards until accepted patches/reconciliation arrive.
- **Sprint 4 decision:** first batch command. It is the clearest N-command user action and exercises idempotency, conflict scopes, accepted patches, and recovery UI without random or hidden state.

### 2. Clear field effects

- **Current UI path:** field-effect menu handlers in `src/pages/maps/[slug].vue` call:
  - `clearWeatherFromMenu` -> `livePlayCommands.removeFieldEffect({ category: 'weather' })`;
  - `removeTerrainFromMenu` / `removeRoomFromMenu` -> `removeFieldEffect` for one category/kind;
  - `clearAllFieldEffectsFromMenu` -> `livePlayCommands.removeFieldEffect({ category: 'all' })` after one confirmation.
- **Current command route(s):** `POST /api/maps/field-effects/remove` via `MAP_API_PATHS.removeFieldEffect`; related single-effect routes are `/api/maps/field-effects/set` and `/api/maps/field-effects/tick`.
- **Current command type:** `removeFieldEffect` for routed clears, `setFieldEffect` for setting/round updates, and `tickFieldEffectDurations` for duration cleanup. The shared `clearFieldEffects` batch command contract is defined for the next routing/wiring step.
- **Current payload:** routed clears use category-only clear (`weather`, `terrain`, `room`, or `all`) or category plus explicit `kind`; the batch contract uses `{ category }` or `{ category, kinds }` with a bounded explicit kind list.
- **Current command scopes:** `[{ kind: 'map', lane: 'fieldEffects' }]`.
- **Authority scope:** GM-only map-effect authority. Server validates category/kind combinations, payload shape, stale/conflicting revisions, and no-op clears.
- **Likely batch conflict scopes:** conservative map `fieldEffects` lane for all category/kind modes. This should conflict with set/remove/tick field-effect commands but not unrelated token movement.
- **Current accepted patch shape:** one `map.fieldEffects` patch with `previous`, `current`, optional `category`, optional `kind`, and optional `tickAmount`.
- **Expected batch patch shape:** can reuse a `map.fieldEffects` patch carrying previous/current field-effect state plus category/kind summary. No whole-map replacement is required.
- **Local prediction safety:** not currently predicted. Keep as pending-only and reconcile from accepted patches.
- **Sprint 4 decision:** implement after hazards. Although clear-all is already one request, an explicit `clearFieldEffects` contract makes category/all clears visible as batch operations in validation, outbox summaries, and operator smoke tests.

### 3. Repeated terrain voxel edits

- **Current UI path:** `IsometricGrid.client.vue` click handling calls build interaction `performAction`; page handlers `placeVoxelFromScene` and `removeVoxelFromScene` dispatch one live-play command per clicked voxel when not in setup/edit.
- **Current command route(s):**
  - `POST /api/maps/terrain/build` via `MAP_API_PATHS.buildTerrainVoxel`;
  - `POST /api/maps/terrain/remove` via `MAP_API_PATHS.removeTerrainVoxel`.
- **Current command types:** `buildTerrainVoxel`, `removeTerrainVoxel`.
- **Current payloads:** `{ voxel }` for add/update and `{ cell }` for removal.
- **Current command scopes:** `[{ kind: 'map', lane: 'terrain' }]` in the envelope. The client/server conflict helpers derive a terrain-cell descriptor from the payload for single-voxel commands, while broad terrain-lane scopes still conflict with all terrain cells.
- **Authority scope:** GM-only terrain authority. Server validates payload shape, material palette, bounds, no-op updates/removals, map revision, and conflict history.
- **Likely batch conflict scopes:** explicit terrain-cell descriptors for bounded cell batches when possible; broad `terrain` lane for oversized/ambiguous operations. Mixed add/remove payloads must reject duplicate or contradictory operations in the same cell.
- **Current accepted patch shape:** one `map.terrain` patch with `cell`, `previous`, `current`, optional `built`, optional `removed`, and `rendererInvalidation` reasons.
- **Expected batch patch shape:** one accepted terminal result containing changed terrain cells and final cell states, or a conservative final terrain set when precise patches become too large. Avoid whole-map adoption when practical.
- **Local prediction safety:** no authoritative terrain prediction today. The existing ghost/preview is presentation-only; batch terrain edits should remain pending-only until accepted.
- **Sprint 4 decision:** add `editTerrainVoxels` plus client stroke coalescing. This turns repeated terrain clicks/brush strokes into bounded authoritative transactions without making clients authoritative.

### 4. Repeated hazard cell edits

- **Current UI path:** `IsometricGrid.client.vue` hazard interaction calls page handlers `placeHazardFromScene` and `removeHazardFromScene`; each live-play click dispatches one command.
- **Current command route(s):**
  - `POST /api/maps/hazards/place` via `MAP_API_PATHS.placeHazard`;
  - `POST /api/maps/hazards/remove` via `MAP_API_PATHS.removeHazard`.
- **Current command types:** `placeHazard`, `removeHazard`.
- **Current payloads:** `{ hazard }` for placement/update and `{ cell }` for removal.
- **Current command scopes:** `[{ kind: 'map', lane: 'hazards' }]`.
- **Authority scope:** GM-only map-effect authority. Server validates hazard kind/layer/owner, bounds, no-op placement/removal, stale revisions, and conflicts.
- **Likely batch conflict scopes:** hazard batches must conflict with broad clear-hazards and single-hazard commands. If future contracts introduce explicit hazard-cell descriptors, they should still conflict with the broad map hazard lane.
- **Current accepted patch shape:** one `map.hazards` patch with the affected `cell`, `previous`, `current`, optional `placed`, and `removed` hazards.
- **Expected batch patch shape:** one accepted terminal result with added/updated/removed cells and final hazard states. It should be precise enough to avoid whole-map replacement for normal brush strokes.
- **Local prediction safety:** no local authoritative prediction. Keep hazard brush results pending-only.
- **Sprint 4 decision:** add `editHazards` after terrain batching. It has similar bounded-cell mechanics and should reuse shared guardrails for duplicate/contradictory cells.

### 5. Initiative cleanup

- **Current UI path:** `useInitiativeTracker` exposes initiative modal actions:
  - `fillInitiativeFromSpeed` loops placements and dispatches `setInitiative({ tokenId, initiative })` in live play;
  - `clearInitiativeValues` loops placements with `setInitiative({ tokenId, initiative: null })`, then dispatches `setInitiative({ activeId: null, round: 1 })`.
- **Current command route(s):** `POST /api/maps/initiative/set` via `MAP_API_PATHS.setInitiative`. Advancing uses `/api/maps/initiative/next` and `/api/maps/initiative/previous`.
- **Current command types:** `setInitiative`, `nextInitiative`, `previousInitiative`.
- **Current command scopes:** `setInitiative` uses map `initiative`; `nextInitiative`/`previousInitiative` use map `initiative` plus map `metadata` because advancement may write logs/order side effects.
- **Authority scope:** GM-only initiative authority. Server validates active IDs, round, submitted visible order for advancement, revision, and conflicts.
- **Likely batch conflict scopes:** map `initiative` plus map `metadata` if a batch can reset active/round or write logs. A future initiative batch must define whether it changes only placement initiative values or also active turn/round/metadata side effects.
- **Current accepted patch shape:** `map.initiative` patch with previous/current lane state and changed token IDs; advancement may also include a `map.metadata` patch.
- **Local prediction safety:** not currently predicted.
- **Sprint 4 decision:** later. It is a valid N-command cleanup, but the sprint priorities are hazard/field-effect/terrain/hazard-cell batches. Initiative batching needs a separate contract so it does not accidentally weaken visible-order validation or log/metadata side-effect rules.

### 6. Scene and combat-log cleanup

- **Current UI path:** scene panel start/end calls `livePlayCommands.setScene({ name })` or `setScene({ name: null })`. Combat-log clearing is guarded by `isSetupEditMode()` in the admin panel path and mutates local setup state only.
- **Current command route(s):** `POST /api/maps/scene/set` via `MAP_API_PATHS.setScene`.
- **Current command type:** `setScene`.
- **Current command scopes:** `[{ kind: 'map', lane: 'scene' }]`.
- **Authority scope:** GM-only scene authority. Server validates scene payload and map revision/conflicts.
- **Likely batch conflict scopes:** map `scene` if ever expanded; no batch needed for current start/end.
- **Current accepted patch shape:** `map.scene` patch with `previous` and `current` scene state.
- **Local prediction safety:** not predicted.
- **Sprint 4 decision:** not worth batching now. There is no repeated live-play command loop for scene start/end, and combat-log cleanup is not a live-play command path today.

### 7. Action automation loops

- **Current UI path:** normal live-play move automation calls `dispatchMoveAutomationAuthoritatively`, which sends `livePlayCommands.resolveMove(...)`. The older `applyMoveAutomation` path loops over HP, combat-stage, condition, field-effect, hazard, and movement updates, but the map page wires authoritative dispatch for live play before that fallback runs.
- **Current command route(s):**
  - primary: `POST /api/maps/tokens/resolve-move` via `MAP_API_PATHS.resolveMove`;
  - related primitives/fallbacks: `POST /api/maps/use-move`, `/api/maps/tokens/modify-hp`, `/api/maps/tokens/modify-combat-stages`, `/api/maps/tokens/modify-conditions`, `/api/maps/field-effects/set`, `/api/maps/hazards/place`, and `/api/maps/tokens/move`.
  - ability/maneuver/order actions use `POST /api/maps/tokens/use-ability`, `/api/maps/tokens/use-maneuver`, and `/api/maps/tokens/use-order`.
- **Current command type:** primary `resolveMove`; primitives remain available for direct non-move workflows.
- **Current command scopes:** resolve-move scopes include actor action/move usage, actor and target token/sheet HP/combat/condition fields, map metadata, map hazards, and map field effects, bounded by `LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT`.
- **Authority scope:** GM or selected player profile must control the acting token; server validates map visibility, selected profile links, move intent, base revision, exact revision requirement, and deterministic result application.
- **Likely batch conflict scopes:** already broad enough for the command's possible side effects. Do not replace with a generic list-of-commands batch.
- **Current accepted patch shape:** accepted move results may include token, sheet, map hazard/field-effect, metadata, movement, and move-state patches plus presentation data for the move result.
- **Local prediction safety:** complex move side effects are not locally predicted as authoritative state. Presentation VFX/feedback is transient and separate from command authority.
- **Sprint 4 decision:** not worth batching. `resolveMove` is already the authoritative transaction for move automation. Reaction prompts that send one or a few targeted sheet commands can be revisited later if they become a clear repeated workflow.

## Why Sprint 4 starts with hazards, field effects, terrain, and hazard cells

The selected Sprint 4 batch commands are deliberately narrow map-effect/brush workflows:

1. **`clearHazards`** removes the worst current N-request cleanup while staying within GM-only map hazard authority.
2. **`clearFieldEffects`** gives category/all field-effect clears an explicit batch contract and consistent outbox/recovery presentation even though the current clear-all route is already one request.
3. **`editTerrainVoxels`** turns repeated terrain painting into bounded cell batches and can reuse existing terrain-cell conflict precision.
4. **`editHazards`** applies the same bounded-cell pattern to hazard drawing/removal and should conflict conservatively with clear-hazard operations.

These choices avoid the sprint non-goals: no generic macro engine, no browser-owned authority, no whole-map saves for live play, no hidden/random-result batching, and no expansion of complex local prediction.
