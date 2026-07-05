# Live play token motion

This document audits the current token-movement presentation path for Live Play Sprint 5. It describes the behaviour that exists before explicit motion tracks are introduced. Token motion is presentation-only: authoritative placement still comes from live-play commands, accepted patches, reconciliation snapshots, or setup/edit map state.

## Current source of truth

- A token's real board position is the placement in the reactive map document.
- The isometric scene receives visible placements as `SpawnedPokemon[]` through `IsometricGrid.client.vue` props.
- Renderer-owned `PokemonRenderObject` instances keep presentation state (`currentCenter`, `targetCenter`, selection lift, Three.js/CSS3D objects) that is not serialized to map data.
- Existing movement smoothing is a generic center interpolation from `currentCenter` toward `targetCenter`; it is not tied to a command, duration, path, reduced-motion preference, or correction reason.

## Current movement pipeline

```text
live-play/setup edit changes map placements
  -> page recomputes visible SpawnedPokemon props
  -> IsometricGrid watcher syncs PokemonRenderObject entries
  -> updatePokemonRenderObjectFromSpawn writes targetCenter and token metadata
  -> render scheduler requests a token frame
  -> stepIsometricAnimationFrame damps currentCenter toward targetCenter
  -> applyPokemonRenderObjectPosition moves WebGL objects and CSS3D HUD from currentCenter
  -> renderLoop keeps RAF active while currentCenter/lift have not settled
```

### Placement changes entering the grid

`src/pages/maps/[slug].vue` owns the map state and passes `spawnedPokemon` into the isometric grid. Manual movement in the grid starts in `createIsometricTokenMovementInteractionController()`:

1. Pointer movement builds a preview and optional movement-path result for display.
2. `performSelectedMove()` emits `move-pokemon` with `{ id, position }`.
3. The page-level `movePokemon()` handler either:
   - updates setup/edit placement state directly, or
   - sends `livePlayCommands.moveToken()` in Run Live Play.

In Run Live Play, `useLivePlayCommands()` journals the command in the durable outbox, creates an `opId`, and tries to build a local prediction. A valid move prediction mutates `map.value.placements` immediately via `applyLivePlayPredictionToMap()`, including predicted position and facing. That mutation changes `spawnedPokemon`, which is the current renderer entry point for local predicted movement.

### Render-object sync

`src/composables/isometric/useIsometricSceneWatchers.ts` watches the `pokemons` source deeply. When it changes, `syncPokemonObjects()` in `IsometricGrid.client.vue` calls `syncPokemonRenderObjects()`.

For each visible Pokémon:

- New render objects are created by `createPokemonRenderObject()` in `src/utils/isometric/tokenRenderer.ts`.
  - `currentCenter` is initialized from `pokemonRenderSpawnState(pokemon).center`.
  - `targetCenter` is cloned from the same first center.
  - The object is positioned immediately, so new tokens do not slide from world origin.
- Existing render objects are updated by `updatePokemonRenderObjectFromSpawn()`.
  - `targetCenter` is set to the latest placement center.
  - `currentCenter` is not reset on ordinary updates.
  - Dimensions, elevation, sprite URLs/animations, facing, HP/status HUD inputs, combat stages, token items, and accent color are refreshed in the same update path.

There is no current comparison that distinguishes a placement move from a sheet/HUD-only update. Movement occurs only if the updated `targetCenter` differs from `currentCenter` after sync.

### Frame stepping and damping

`renderOneShotScheduledFrame()` calls `stepIsometricAnimationFrame()` in `src/utils/isometric/animationFrame.ts`.

On every scheduled frame:

- `delta` is capped to `0.1` seconds.
- `damping` is calculated as `1 - Math.exp(-delta * 12)`.
- Each render object's `currentCenter` is updated:
  - if `tokenCenterLerpNeedsAnimation(renderObject)` is true, `currentCenter.lerp(targetCenter, damping)` runs;
  - otherwise `currentCenter.copy(targetCenter)` snaps to the exact target.
- The center snap threshold is `TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED` from `src/utils/isometric/tokenRenderState.ts`.

This creates a framerate-independent exponential ease toward the target. It has no explicit duration; movement asymptotically approaches the target until the epsilon check snaps the last tiny tail.

### WebGL and CSS3D placement

After center interpolation, `applyPokemonRenderObjectPosition()` applies `currentCenter` to all token-adjacent render objects:

- Pokémon sprite and sprite halo use `currentCenter`.
- Tactical volume, edges, and invisible proxy pick mesh use `currentCenter` plus clearance/height offsets.
- Contact shadow uses `currentCenter.x/z` and a voxel-aware surface lookup so it projects onto the floor or terrain beneath the token footprint.
- Elevation badge, combat-stage glass, and HP/status bar receive `currentCenter` and token metadata.
- CSS HUD helpers report whether their DOM/CSS3D output changed; changed HUD output marks the CSS3D renderer dirty.

`animatePokemonRenderObject()` then applies facing/sprite animation/lighting and selection lift. Selection lift is separate from movement: it eases `liftFactor` toward `liftTarget`, raises sprite/halo/HP bar, and scales/fades the contact shadow while leaving tactical footprint anchoring intact.

### Render continuation

`src/utils/isometric/renderLoop.ts` currently treats token motion as active when any render object still needs center interpolation or selection-lift interpolation:

- `resolveIsometricTokenMotionContinuationSources(renderObjects.values())`
- `anyTokenRenderStateNeedsAnimation()`
- `tokenRenderStateNeedsAnimation()`

`IsometricGrid.client.vue` includes that source in `resolveSceneAnimationContinuation()`. The render scheduler continues requesting animation frames while the `token-motion` continuation source is active and stops when all centers and lift factors have settled. CSS3D dirty tracking also marks token-motion animation frames so HP bars/elevation badges can follow moving/lifting tokens.

## Live-play paths that currently become renderer movement

All of the following paths eventually enter the renderer as ordinary `pokemons` prop changes. The renderer does not currently know which path caused the new `targetCenter`.

### Local predicted movement

- `movePokemon()` records the pending prediction-op set, dispatches `livePlayCommands.moveToken()`, and then checks whether a new move prediction appeared.
- `useLivePlayCommands.trackLocalPrediction()` builds a move prediction and calls `applyLivePlayPredictionToMap()` immediately.
- The predicted placement updates `spawnedPokemon` and then `targetCenter`.
- The token is also marked pending through `livePlayPendingTokenIds`, which changes tactical cage styling but not movement math.

### Local authoritative confirmation

Accepted HTTP responses or accepted SSE acknowledgements call `adoptAcceptedLivePlayResponse()`, which applies authoritative patches or a map fallback. Patch adoption hooks temporarily roll back pending predictions before applying accepted patches, then remove or reapply predictions as needed. The renderer only observes the resulting placement state after Vue reactivity flushes; it has no explicit "local confirmation" reason and no way to preserve or merge an in-progress predicted animation.

### Remote accepted movement

`useEditableMap.handleAcceptedLivePlayCommandEvent()` receives accepted live-play SSE events, validates revision continuity, runs prediction adoption hooks, and applies `applyLivePlayPatchesToMap()`. A remote `token.position` patch updates the map placement and therefore the grid's `pokemons` prop. The renderer treats it exactly like any other `targetCenter` change.

### Rejected predictions and correction notices

Rejected terminal command responses call `markOperationFailed()`, which rolls back the local prediction through `rollbackLivePlayPredictionFromMap()`. The page also shows a correction notice and passes `livePlayCorrectionTokenIds` into the grid, which affects tactical cage styling. The renderer sees the rollback as another placement update toward the previous center; there is no correction-specific timing or snap/animate policy.

### Coalesced same-token movement

`useLivePlayCommands()` keeps a per-placement move-token coalescing queue. A newer queued move for the same placement supersedes the older queued move, rolls back the old local prediction if it is still applied, and tracks the new prediction. Renderer state changes are still just placement changes. There is no sampled-position replacement policy, so repeated destinations rely on the generic `currentCenter`/`targetCenter` lerp behaviour and the timing of prediction rollback/reapply updates.

### Reconnect and authoritative reconciliation

Realtime gaps, replay validation failures, profile changes, or explicit reconciliation call `reconcileAuthoritativeMap()`. Before reconciliation, pending predictions are cleared through `clearPendingPredictionsForReconciliation()`. The aggregate live-table snapshot then updates the map via `applyPersistedMap()`. Existing render objects whose ids survive the snapshot receive new `targetCenter` values; new objects spawn at their first center; removed objects are disposed. There is no snapshot-specific snap/no-animation policy today.

## Current pain points

- **Create/reload teleporting:** newly created or recreated render objects set `currentCenter === targetCenter`, so they appear at the current authoritative center without any deliberate spawn/reload policy.
- **Generic exponential slow tail:** movement uses damping toward a target and finishes only when the epsilon threshold is reached; it has no planned end time.
- **No explicit duration:** movement speed is not derived from grid distance, command type, correction reason, or user preference.
- **No path segments:** even when the movement preview had pathfinding data, committed movement only sends position/path length and the renderer interpolates directly from current center to target center.
- **No correction semantics:** accepted confirmations, rejected rollbacks, authoritative conflicts, and reconciliation snapshots all look like ordinary target-center changes.
- **No reduced-motion policy:** token center movement does not currently consult the browser/OS reduced-motion preference or a token-motion-specific setting.
- **No replacement policy:** rapid same-token moves do not start a new track from a sampled center with defined continuity; they depend on the current lerp state and reactive update order.
- **No source classification in the renderer:** local prediction, remote accepted movement, setup/edit movement, coalesced movement, and snapshot reconciliation all arrive as the same render-object update.
- **HUD and overlays follow the sampled center but are not track-aware:** HP bars, elevation badges, shadows, cages, proxies, targeting affordances, presence overlays, and camera focus currently read `currentCenter` or `targetCenter` according to existing helpers, without a single explicit motion sample contract.

## Runtime motion-track utility foundation

`LP-S5-003` adds `src/utils/isometric/tokenMotionTracks.ts` as the pure runtime model for future renderer-owned token movement. A track records token ID, origin/destination centers, start time, duration, source reason, and optional path-segment metadata. The helpers start tracks, sample eased centers at frame timestamps, replace active tracks from the sampled current center, finish at the destination, and cancel by either sampling or snapping. This state is presentation-only and is not written to map data; the renderer continues to use the legacy center lerp until the later wiring tickets attach tracks to render objects and frame stepping.

`LP-S5-004` gives each `PokemonRenderObject` a renderer-owned `motion` state bag. `motion.track` is optional runtime-only metadata for the active presentation track, while `motion.sampledCenter` is the explicit output center that later frame stepping can copy into the existing `currentCenter` compatibility field. New render objects initialize `currentCenter`, `targetCenter`, and `motion.sampledCenter` from the same first authoritative placement center so they do not slide in from origin or another token. Disposal clears any active motion-track metadata before releasing Three.js/CSS3D resources.

## Future Sprint 5 change map

The current code suggests this division for later tickets:

### Pure/testable motion utilities

- `LP-S5-002`: easing, distance-based duration, reduced-motion duration, and center interpolation helpers. Implemented in `src/utils/isometric/tokenMotionCurves.ts` as pure center-point math so future tracks can sample motion without importing three.js.
- `LP-S5-003`: runtime motion-track model and sampling/cancel/replace helpers. Implemented as pure presentation utilities in `src/utils/isometric/tokenMotionTracks.ts`; not yet wired into render objects.
- `LP-S5-007`: sampled-position replacement rules for rapid same-token movement.
- `LP-S5-008`: path segment construction and proportional segment sampling.
- `LP-S5-009`: deterministic elevation/hop sampling that can be reduced or disabled.
- `LP-S5-010`: movement-facing timing policy helpers.
- `LP-S5-011`: correction/rollback duration and snap policy helpers.
- `LP-S5-013`: central reduced-motion and many-token performance policy helpers.

### Renderer and scene wiring

- `LP-S5-004`: implemented in `PokemonRenderObject.motion` as runtime-only `track` metadata plus a `sampledCenter` output while keeping `currentCenter`/`targetCenter` compatibility.
- `LP-S5-005`: sample explicit tracks in `stepIsometricAnimationFrame()`, update render continuation, and keep CSS HUD updates synchronized.
- `LP-S5-006`: detect placement-position changes during token object sync and start tracks only for existing-token movement.
- `LP-S5-012`: classify local prediction, local confirmation, remote accepted movement, and duplicate terminal delivery well enough to avoid stutter.
- `LP-S5-014`: expose aggregate motion metrics in debug tooling without private token details.
- `LP-S5-015`: add restrained renderer-owned start/end polish that remains separate from authoritative placement.

### Documentation and regression coverage

- `LP-S5-016`: live-play prediction/batch regressions should assert final authoritative map state and revisions, not just animation state.
- `LP-S5-017`: operator smoke checks should exercise normal movement, remote observers, replacement, path/elevation, rollback, reconnect, reduced motion, and batch edits while emphasizing that animation is not authority.
