# Live play token motion

This document audits the current token-movement presentation path for Live Play Sprint 5. It describes the behaviour that exists before explicit motion tracks are introduced. Token motion is presentation-only: authoritative placement still comes from live-play commands, accepted patches, reconciliation snapshots, or setup/edit map state.

## Current source of truth

- A token's real board position is the placement in the reactive map document.
- The isometric scene receives visible placements as `SpawnedPokemon[]` through `IsometricGrid.client.vue` props.
- Renderer-owned `PokemonRenderObject` instances keep presentation state (`currentCenter`, `targetCenter`, selection lift, Three.js/CSS3D objects) that is not serialized to map data.
- Existing movement smoothing was a generic center interpolation from `currentCenter` toward `targetCenter`; `LP-S5-005` keeps that as a compatibility fallback only when no explicit runtime track is active.
- When a renderer-owned `motion.track` exists, the frame step samples that track by timestamp and copies the sampled center into the existing render-object placement fields. The track is still presentation-only and never changes the authoritative map placement.

## Current movement pipeline

```text
live-play/setup edit changes map placements
  -> page recomputes visible SpawnedPokemon props
  -> IsometricGrid watcher syncs PokemonRenderObject entries
  -> existing-token placement changes start a runtime motion track
  -> updatePokemonRenderObjectFromSpawn writes targetCenter and token metadata
  -> render scheduler requests a token frame
  -> stepIsometricAnimationFrame samples the track or damps currentCenter toward targetCenter
  -> applyPokemonRenderObjectPosition moves WebGL objects and CSS3D HUD from currentCenter
  -> renderLoop keeps RAF active while currentCenter/lift have not settled
```

### Placement changes entering the grid

`src/pages/maps/[slug].vue` owns the map state and passes `spawnedPokemon` into the isometric grid. Manual movement in the grid starts in `createIsometricTokenMovementInteractionController()`:

1. Pointer movement builds a preview and optional movement-path result for display.
2. `performSelectedMove()` emits `move-pokemon` with `{ id, position }` and, when the preview has one, a cloned grid-anchor `path`.
3. The page-level `movePokemon()` handler either:
   - updates setup/edit placement state directly, or
   - sends `livePlayCommands.moveToken()` in Run Live Play.

In Run Live Play, movement uses an immediate renderer-owned intent instead of mutating the solid token to its requested destination. The selected token keeps its translucent destination ghost and route while `useLivePlayCommands()` journals and sends the command with move-token prediction disabled for the map page. An ordinary acceptance then moves the solid token along the accepted route. If the server opens a pre-step Attack of Opportunity, only the committed route prefix animates to the authoritative checkpoint; the remaining suffix stays outlined until the durable response resumes or cancels it.

### Render-object sync

`src/composables/isometric/useIsometricSceneWatchers.ts` watches the `pokemons` source deeply. When it changes, `syncPokemonObjects()` in `IsometricGrid.client.vue` calls `syncPokemonRenderObjects()`.

For each visible Pokémon:

- New render objects are created by `createPokemonRenderObject()` in `src/utils/isometric/tokenRenderer.ts`.
  - `currentCenter` is initialized from `pokemonRenderSpawnState(pokemon).center`.
  - `targetCenter` is cloned from the same first center.
  - The object is positioned immediately, so new tokens do not slide from world origin.
- Existing render objects are checked by `syncPokemonRenderObjectPlacementMotion()` before `updatePokemonRenderObjectFromSpawn()` writes the new spawn state.
  - If the next placement center differs from the previous `targetCenter`, a runtime-only motion track starts from the current rendered center to the next authoritative center.
  - If the token already has an active motion track, the old track is sampled at the replacement timestamp and the new track starts from that sampled center instead of the previous authoritative center or a stale frame sample. The replacement duration is based on the remaining distance and active-track pace unless a caller supplies explicit duration options.
  - If the grid captured a movement-preview path for that token and destination, the track stores proportional path segments and samples along those centers instead of drawing a straight line through obstacles. Missing, stale, or invalid paths fall back to direct center-to-center motion.
  - Pure sheet/HUD updates such as HP, conditions, combat stages, token items, and accent color leave `targetCenter` unchanged and do not start movement tracks.
  - If a changed target is already at the sampled/rendered center, stale motion metadata is cleared instead of animating a no-op.
- Existing render objects are then updated by `updatePokemonRenderObjectFromSpawn()`.
  - `targetCenter` is set to the latest placement center.
  - `currentCenter` is not reset on ordinary updates.
  - Dimensions, elevation, sprite URLs/animations, facing, HP/status HUD inputs, combat stages, token items, and accent color are refreshed in the same update path.

Movement now has an explicit track when an existing visible token changes placement. The compatibility center lerp remains only for tokens without tracks or legacy states.

### Frame stepping and damping

`renderOneShotScheduledFrame()` calls `stepIsometricAnimationFrame()` in `src/utils/isometric/animationFrame.ts`.

On every scheduled frame:

- `delta` is capped to `0.1` seconds.
- `damping` is calculated as `1 - Math.exp(-delta * 12)` for compatibility fallback and selection lift.
- `frameNowMs` is resolved once and used to sample explicit runtime token-motion tracks.
- Each render object's `currentCenter` is updated:
  - if `motion.track` exists, `sampleTokenMotionTrack(track, frameNowMs)` writes the sampled center to `currentCenter` and `motion.sampledCenter`; a completed sample lands exactly on the track destination and clears the runtime track;
  - elevation-changing tracks may add a deterministic, visual-only hop offset to the sampled center between the grounded origin and destination; reduced-motion planning can remove that hop;
  - otherwise, if `tokenCenterLerpNeedsAnimation(renderObject)` is true, `currentCenter.lerp(targetCenter, damping)` runs;
  - otherwise `currentCenter.copy(targetCenter)` snaps to the exact target.
- The center snap threshold for the fallback path is `TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED` from `src/utils/isometric/tokenRenderState.ts`.

Explicit tracks now have planned end times. The generic exponential ease remains available only for tokens that do not yet have a track or for compatibility states, so movement wiring can migrate one source at a time without changing authoritative placement data.

### WebGL and CSS3D placement

After center interpolation, `applyPokemonRenderObjectPosition()` applies `currentCenter` to all token-adjacent render objects:

- Pokémon sprite and sprite halo use `currentCenter`.
- Tactical volume, edges, and invisible proxy pick mesh use `currentCenter` plus clearance/height offsets.
- Contact shadow uses `currentCenter.x/z` and a voxel-aware surface lookup so it projects onto the floor or terrain beneath the token footprint instead of sticking to a lifted/hopped sprite sample.
- Elevation badge, combat-stage glass, and HP/status bar receive `currentCenter` and token metadata, so HUD elements follow the same visual movement sample while their text still comes from authoritative token data.
- CSS HUD helpers report whether their DOM/CSS3D output changed; changed HUD output marks the CSS3D renderer dirty.

`animatePokemonRenderObject()` then applies facing/sprite animation/lighting, selection lift, and movement polish. Active movement tracks use a runtime-only facing plan: the sprite faces the first non-zero travel segment while the track is in flight, then falls back to the latest authoritative facing after the track clears. Pure `turnToken`/facing-only updates do not start placement motion and clear the temporary travel-facing plan, so explicit turns remain responsive even if center motion is still in progress. Selection lift is separate from movement: it eases `liftFactor` toward `liftTarget`, raises sprite/halo/HP bar, and scales/fades the contact shadow while leaving tactical footprint anchoring intact. Track-owned motion polish adds only a tiny start/end sprite/halo pulse and a slight contact-shadow breath; it resets from base dimensions every frame, leaves cages/proxies at the sampled tactical center, and is disabled for reduced-motion tracks.

### Render continuation

`src/utils/isometric/renderLoop.ts` treats token motion as active when any render object still has an explicit `motion.track`, needs fallback center interpolation, or needs selection-lift interpolation:

- `resolveIsometricTokenMotionContinuationSources(renderObjects.values())`
- `anyTokenRenderStateNeedsAnimation()`
- `tokenRenderStateNeedsAnimation()`

`IsometricGrid.client.vue` includes that source in `resolveSceneAnimationContinuation()`. The render scheduler continues requesting animation frames while the `token-motion` continuation source is active and stops after completed tracks are sampled and all centers/lift factors have settled. CSS3D dirty tracking also marks token-motion animation frames so HP bars/elevation badges can follow moving/lifting tokens.

## Live-play paths that currently become renderer movement

All of the following paths eventually enter the renderer as ordinary `pokemons` prop changes. The renderer does not currently know which path caused the new `targetCenter`.

### Local movement intent and authoritative confirmation

- `movePokemon()` captures the selected preview route as `LivePlayMovementIntent` before dispatching `livePlayCommands.moveToken()`.
- The intent locks that preview against pointer changes and leaves the solid map placement untouched while transport is pending.
- Accepted HTTP responses or accepted SSE acknowledgements apply authoritative patches or a map fallback. The retained preview path is consumed only when placement advances.
- A complete acceptance animates the whole route. A suspended acceptance splits it into the committed prefix and remaining suffix, so resumed movement starts at the checkpoint and never animates backward.
- Full-map fallback adoption normally snaps as reconciliation, but the one token owning the active movement intent is explicitly allowed to consume its accepted route before the intent clears on the next render tick.
- Turn, condition, and other supported command predictions remain independent; the `useLivePlayCommands()` prediction option defaults to compatibility behavior outside the map page.

### Remote accepted movement

`useEditableMap.handleAcceptedLivePlayCommandEvent()` receives accepted live-play SSE events, validates revision continuity, runs prediction adoption hooks, and applies `applyLivePlayPatchesToMap()`. A remote `token.position` patch updates the map placement and therefore the grid's `pokemons` prop. The map page marks successfully applied remote accepted movement IDs for one render tick, and the grid classifies those placement tracks as `remote-accepted`. Stale duplicate terminal events are still acknowledged for recovery bookkeeping but are reported as unapplied, so they do not restart token motion.

### Rejected intent and predicted-command corrections

A rejected movement command clears the renderer-owned intent and leaves the already-authoritative solid token in place, so there is no movement rollback. Predictions retained for other command types still use the existing correction path: rejected terminal responses call `markOperationFailed()`, roll back through `rollbackLivePlayPredictionFromMap()`, and use correction or reconciliation presentation policy as appropriate.

### Coalesced same-token movement

`useLivePlayCommands()` keeps a per-placement move-token coalescing queue. A newer queued move for the same placement supersedes the older queued move, rolls back the old local prediction if it is still applied, and tracks the new prediction. Renderer state changes are still just placement changes, but an active token-motion track is now replaced from its sampled in-flight center when the same visible token receives a new placement target. That prevents rapid repeated destinations from snapping back to the old authoritative center during rollback/reapply ordering; the latest authoritative or predicted target remains the final destination.

### Reconnect and authoritative reconciliation

Realtime gaps, replay validation failures, profile changes, or explicit reconciliation call `reconcileAuthoritativeMap()`. Before reconciliation, pending predictions are cleared through `clearPendingPredictionsForReconciliation()`, and any tracked token predictions are marked with a transient snap-correction policy for the next renderer sync. The aggregate live-table snapshot then updates the map via `applyPersistedMap()` and increments the page's `mapDataRevision`, which is passed through the scene components to the grid. Existing render objects whose ids survive the snapshot snap to the fresh authoritative centers without replaying stale local intent; new objects spawn at their first center; removed objects are disposed.

## Current pain points

- **Create/reload teleporting:** newly created or recreated render objects set `currentCenter === targetCenter`, so they appear at the current authoritative center without any deliberate spawn/reload policy.
- **Generic exponential slow tail:** movement uses damping toward a target and finishes only when the epsilon threshold is reached; it has no planned end time.
- **No explicit duration:** movement speed is not derived from grid distance, command type, correction reason, or user preference.
- **Limited path context:** local committed movement can now reuse the current preview path, but remote accepted movement, corrections, and reconciliation snapshots still arrive as placement-only updates and fall back to direct motion unless a later source supplies safe path context.
- **Movement interruption presentation is explicit:** local movement retains an intent ghost and a route split at authoritative reaction checkpoints. Rejected movement clears the intent without moving the solid token backward; unrelated predicted-command correction behavior remains narrow.
- **Reduced-motion and performance policy is now explicit:** token placement motion reuses the existing move-animation reduced-motion signal. Ordinary moves shorten to a brief state change, correction moves shorten further, reconciliation still snaps, and a simultaneous-track cap snaps overflow movement so a large batch cannot keep unbounded token animation work alive.
- **Limited replacement source context:** rapid same-token moves now replace active tracks from the sampled in-flight center, and placement-motion reasons cover local prediction, remote accepted movement, server correction, reconciliation, and setup/edit. Path context is still local-preview only, so remote accepted movement usually falls back to direct interpolation.
- **HUD and overlays follow the sampled center but are not track-aware:** HP bars, elevation badges, shadows, cages, proxies, targeting affordances, presence overlays, and camera focus currently read `currentCenter` or `targetCenter` according to existing helpers, without a single explicit motion sample contract.

## Runtime motion-track utility foundation

`LP-S5-003` adds `src/utils/isometric/tokenMotionTracks.ts` as the pure runtime model for future renderer-owned token movement. A track records token ID, origin/destination centers, start time, duration, source reason, and optional path-segment metadata. The helpers start tracks, sample eased centers at frame timestamps, replace active tracks from the sampled current center, finish at the destination, and cancel by either sampling or snapping. This state is presentation-only and is not written to map data; the renderer continues to use the legacy center lerp until the later wiring tickets attach tracks to render objects and frame stepping.

`LP-S5-004` gives each `PokemonRenderObject` a renderer-owned `motion` state bag. `motion.track` is optional runtime-only metadata for the active presentation track, while `motion.sampledCenter` is the explicit output center that later frame stepping can copy into the existing `currentCenter` compatibility field. New render objects initialize `currentCenter`, `targetCenter`, and `motion.sampledCenter` from the same first authoritative placement center so they do not slide in from origin or another token. Disposal clears any active motion-track metadata before releasing Three.js/CSS3D resources.

`LP-S5-005` wires that state into frame stepping. `stepIsometricAnimationFrame()` samples active tracks with the current frame timestamp, clears them only after an end-time sample reaches the exact destination, and lets `applyPokemonRenderObjectPosition()` continue to move sprites, shadows, cages, proxies, elevation badges, combat-stage glass, and HP bars from the same sampled center. Render continuation now sees explicit tracks as token-motion work, so RAF stays alive while a track exists and stops after completion.

`LP-S5-006` starts those tracks during token-object sync for existing visible tokens whose placement center changes. New tokens still initialize at their first authoritative center without spawn animation, removed tokens are disposed without delete animation, and sheet/HUD-only updates do not create movement tracks. The initial source reason is the generic `setup-edit` reason because the grid still receives placement changes without live-play source classification; later tickets refine local prediction, remote accepted, correction, and reconciliation reasons.

`LP-S5-007` makes active same-token movement replacement continuous. `replaceTokenMotionTrack()` samples the active track at the replacement timestamp, carries that sampled center into the new origin, and resolves the new duration from remaining distance at the prior track's average pace unless explicit duration options are supplied. `syncPokemonRenderObjectPlacementMotion()` uses that replacement path for visible tokens that receive a new placement target while already moving, so coalesced predictions and rapid repeated clicks do not visually snap back to stale centers.

`LP-S5-008` adds path-aware local movement. The movement interaction controller keeps an immutable copy of the preview path when a move is confirmed; `IsometricGrid.client.vue` holds that pending path only long enough to match the next visible placement update for the same token and destination. `tokenMotionTracks.ts` can build path segments from center waypoints, assign segment durations proportional to path distance, and sample the active track along those segments. If the path is absent, stale, malformed, or too short to be useful, motion falls back to direct interpolation and still ends at the authoritative destination.

`LP-S5-009` adds a subtle vertical affordance for elevation-changing movement. Direct tracks and path segments resolve a small deterministic hop height from their origin/destination elevation delta, sample that hop as a y-offset that is zero at the grounded endpoints, and omit it under the reduced-motion policy by default. The hop is presentation-only: authoritative placement remains `targetCenter`/map data, contact shadows still project to terrain surfaces, and HUD elements continue following the sampled visual center.

`LP-S5-010` coordinates sprite facing with token movement. `tokenMotionTracks.ts` resolves a facing plan from the first non-zero direct/path segment plus the final authoritative facing. `syncPokemonRenderObjectPlacementMotion()` attaches that plan to the renderer-owned motion state when a placement track starts or is replaced. The renderer uses the travel-facing plan only while its owning track is active, avoids per-segment flipping, clears the plan on completion/disposal, and drops it immediately for facing-only updates so explicit turn commands stay responsive.

`LP-S5-011` adds rollback-specific motion policy. `resolveTokenMotionDurationOptionsForReason('server-correction')` caps correction movement to a short, deterministic duration and can shorten or snap under reduced motion. The map page marks safe predicted-token rejections for correction motion without changing the authoritative rollback path, while stale-revision and authoritative-reconciliation cleanup mark transient snap corrections. Full snapshot adoption is keyed by `mapDataRevision`, so surviving render objects clear any stale motion track and snap to the fresh authoritative center instead of animating from an obsolete local prediction.

`LP-S5-012` separates local prediction from remote accepted movement. `useEditableMap()` reports whether each accepted realtime event was applied, stale, a local authoritative confirmation, or a remote accepted update. The map page uses that metadata to mark only successfully applied remote `token.position` patches for `remote-accepted` motion, while `livePlayPendingTokenIds` classifies local predicted movement as `local-prediction`. Matching local authoritative confirmations and duplicate terminal deliveries do not create a new placement target, so they do not restart active motion.

`LP-S5-013` connects token placement motion to accessibility and performance policy. The grid already receives `moveAnimationsReducedMotion` from `useMoveAnimationSettings()`, which follows the browser `prefers-reduced-motion` media query. That signal now flows into every placement-motion reason instead of only server corrections: normal predicted/remote/setup movement resolves to the short reduced duration, server corrections use the even shorter correction duration, and reconciliation/snap corrections remain snapped. The sync path also counts active renderer-owned token tracks and passes that count into the pure performance policy; once the simultaneous-track cap is full, additional placement changes snap directly to their authoritative centers without creating new runtime tracks. Completed tracks are still cleared by the frame sampler at their planned destination, so render continuation stops as soon as no track, fallback center lerp, selection lift, preview, field effect, sprite, or move VFX source remains active.

`LP-S5-014` adds optional debug-only token-motion metrics to the live-play latency panel behind `?debugLivePlayLatency=1`. The renderer emits aggregate counts only: active moving token count, longest active motion age, cumulative completed motion count, and source-reason counts for active/started/completed tracks. The panel deliberately omits token IDs, names, sheet data, path cells, and command payloads, so the metrics help compare command latency with presentation smoothness without exposing hidden token information.

`LP-S5-015` adds renderer-owned start/end polish on top of placement sampling. `tokenMotionTracks.ts` resolves a restrained polish config for ordinary non-reduced tracks and samples a double pulse near motion start and end. `tokenRenderer.ts` applies that pulse as small sprite/halo scale and halo alpha changes plus a mild shadow scale/opacity adjustment. The tactical cage, picking proxy, authoritative target center, and contact-shadow projection stay unchanged, so the pulse reads as life without becoming gameplay authority.

## Operator smoke coverage

The movement-feel checklist lives in [Private VPS live-play smoke checklist](private-vps-live-play-smoke.md#live-play-sprint-5-token-motion-smoothness-smoke). Run it with the GM browser plus two separate player browsers so local prediction, remote observation, same-token replacement, path-aware movement, elevation affordances, rejected rollback, reconnect/reconciliation snap, reduced motion, and batch edits while tokens move are all reviewed from the perspectives that matter at the table.

When diagnosing feel, keep the authority boundary visible: animation bridges between the previous rendered center and the latest visible authoritative or predicted placement, but gameplay truth is still the server-accepted map revision or reconciliation snapshot. The optional `?debugLivePlayLatency=1` panel can compare aggregate token-motion metrics with HTTP/SSE command timing. High command latency with normal motion ages points to command transport/acceptance; quick command terminals with long active-motion ages or unexpectedly high active counts points to animation/performance polish. The panel and smoke notes must not record token names, hidden token details, command bodies, profile IDs, hostnames, screenshots, or logs in the repository.

## Sprint 5 completion map

The implemented token-motion system is divided as follows:

### Pure/testable motion utilities

- `LP-S5-002`: easing, distance-based duration, reduced-motion duration, and center interpolation helpers. Implemented in `src/utils/isometric/tokenMotionCurves.ts` as pure center-point math so runtime tracks can sample motion without importing three.js.
- `LP-S5-003`: runtime motion-track model and sampling/cancel/replace helpers. Implemented as pure presentation utilities in `src/utils/isometric/tokenMotionTracks.ts` and wired into renderer-owned runtime state by later Sprint 5 tickets.
- `LP-S5-007`: sampled-position replacement rules for rapid same-token movement. Implemented in `replaceTokenMotionTrack()` and token-object sync.
- `LP-S5-008`: path segment construction and proportional segment sampling. Implemented for locally confirmed preview paths with direct-motion fallback.
- `LP-S5-009`: deterministic elevation/hop sampling that can be reduced or disabled. Implemented for direct tracks and path segments as visual-only y offsets.
- `LP-S5-010`: movement-facing timing policy helpers. Implemented with travel-facing plans that are owned by active runtime tracks and cleared for explicit turn updates.
- `LP-S5-011`: correction/rollback duration and snap policy helpers. Implemented for `server-correction` and reconciliation snap handling.
- `LP-S5-013`: implemented with central reduced-motion and many-token performance policy helpers. The placement sync reuses the existing reduced-motion signal and snaps overflow movement after the simultaneous-track cap.

### Renderer and scene wiring

- `LP-S5-004`: implemented in `PokemonRenderObject.motion` as runtime-only `track` metadata plus a `sampledCenter` output while keeping `currentCenter`/`targetCenter` compatibility.
- `LP-S5-005`: implemented in `stepIsometricAnimationFrame()` and token render-state continuation helpers. Active tracks are sampled by `frameNowMs`, completed tracks clear at their planned destination, the fallback lerp remains for objects without tracks, and CSS/WebGL token attachments continue to use the sampled center.
- `LP-S5-006`: implemented in token object sync. Existing-token placement changes start tracks from the current rendered center; spawns, deletes, and sheet/HUD-only updates do not animate.
- `LP-S5-012`: implemented with accepted-event adoption metadata, transient remote movement IDs, and placement-motion reason priority.
- `LP-S5-014`: implemented with aggregate motion metrics in the `?debugLivePlayLatency=1` panel without private token details.
- `LP-S5-015`: implemented with track-owned start/end polish samples that the renderer applies to sprite scale, halo opacity/scale, and contact-shadow scale/opacity while keeping tactical footprint objects anchored.

### Documentation and regression coverage

- `LP-S5-016`: live-play prediction/batch regressions assert final authoritative map state and revisions, not just animation state.
- `LP-S5-017`: operator smoke checks exercise normal movement, remote observers, replacement, path/elevation, rollback, reconnect, reduced motion, and batch edits while emphasizing that animation is not authority.
