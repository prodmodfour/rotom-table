# Refactor notes

AUTOMATION_STATUS: IN_PROGRESS
CURRENT_NEXT_STEP: Continue one bounded cleanup phase; `npm run typecheck`, `npm test`, and `npm run build` currently pass. `npm run check:move-automation` still fails with the baseline explicit coverage report. Next candidates include another focused map-editor/helper extraction, remaining client helper cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.

## Phase 0 baseline audit

- Repository: `prodmodfour/rotom-table` at `/home/ashraf/desktop/rotom-table`, branch `main`.
- Ignored `rotom_table_old` entirely; no files outside the active repository were inspected for implementation.
- Existing uncommitted work was present before refactoring:
  - `data/maps/airship-habitat-atrium.json`
  - `data/maps/greywater-aqueduct.json`
  - `data/trainers/helix_mercantile_group/lenora_vask/new-trainer.json`
  - `pages/capabilities/[slug].vue`
  - `pages/capabilities/index.vue`
  - `data/sheets/helix_mercantile_group/` (untracked)
- Package scripts at baseline: `dev`, `build`, `preview`, `postinstall`, `check:move-automation`, `sync:item-sprites`.
- Baseline commands:
  - `npm run build` — passed. Nuxt reported existing large chunk warnings.
  - `npm run check:move-automation` — failed before refactoring with explicit move automation coverage `0/769` and a long missing-script list.
  - `sync:item-sprites` was not run because the script has no dry-run option and writes/downloads assets.
- Largest refactor targets by line count:
  - `components/IsometricGrid.client.vue` (~6247 lines)
  - `pages/maps/[slug].vue` (~3519 lines)
  - `pages/sheets/trainers/[slug].vue` (~2361 lines)
  - `pages/pokedex/[[pokemon_name]].vue` (~2153 lines)
  - `pages/sheets/[slug].vue` (~2012 lines)
- Initial duplication clusters confirmed:
  - Auth role constants/type guards duplicated between server and client.
  - Realtime event type duplicated between server and client.
  - JSON clone/stringify helpers duplicated across editable map/sheet composables.
  - Sheet endpoints repeated filesystem walking, folder validation, slug validation, JSON writes, and folder pruning.
  - Map save repeated sheet-file lookup/player-access logic.

## Prioritized checklist

1. Shared auth/realtime/path/serialization helpers with tests.
2. Generic server filesystem and JSON helpers.
3. Consolidated sheet storage module and thin sheet API routes.
4. Map save policy/storage cleanup using shared sheet access helpers.
5. Autosave composable extraction.
6. Map editor page decomposition.
7. Isometric renderer subsystem extraction.
8. Sheet editor decomposition and pure derived-formula tests.

## Implemented in this pass

- Added shared client/server-safe modules for auth roles, realtime channel names/events, sheet kinds, slug/folder validation, and JSON serialization.
- Added server filesystem/JSON helpers and a focused `sheetStorage` module for filesystem-backed Pokémon/trainer sheets.
- Refactored sheet API routes to thin H3 adapters around validation, auth, storage, and realtime publishing.
- Reused sheet storage player-access lookup in map save policy to remove duplicated sheet file walking.
- Kept map storage behavior compatible while centralizing shared slug/folder validation.
- Added Vitest with unit tests for auth guards, path/folder validation, serialization, filesystem path safety, and sheet storage filename/slug fallback behavior.

## Current quality gate results

- `npm run typecheck` — passes.
- `npm test` — passes: 145 test files / 565 tests.
- `npm run build` — passes; existing large chunk warnings remain.
- `npm run check:move-automation` — still fails with the same baseline `Explicit move automation coverage: 0/769` missing-script report.
- `npm run sync:item-sprites -- --dry-run` was not run because the script does not implement a dry-run mode.

## Next phase update: map save policy/use case

- Extracted player-vs-GM map save rules from `server/api/maps/save.post.ts` into `server/policies/mapPolicy.ts`.
- Added `server/useCases/saveMap.ts` to orchestrate map load, save permission, player placement merge policy, persistence normalization, write, and realtime event construction.
- Reduced `server/api/maps/save.post.ts` to an H3 adapter for auth, request validation, use-case invocation, realtime publish, and response formatting.
- Added tests in `tests/server/mapPolicy.test.ts` covering:
  - GM vs player save visibility policy.
  - anchor clamping to map dimensions.
  - player saves only merging controlled placement position/turned changes.
  - players being unable to add/delete tokens or mutate map metadata/terrain/visibility/initiative.
  - sheet identity mismatch protection.
- Began map editor decomposition by extracting Pokémon/trainer sheet mutation differences from `pages/maps/[slug].vue` into `utils/sheetMutations.ts`.
- Replaced repeated HP/combat-stage/condition Pokémon-vs-trainer save branches in the map page with one `updatePlacedSheet` flow that commits optimistic local updates, persists through `/api/sheets/save`, and rolls back on failure.
- Added tests in `tests/utils/sheetMutations.test.ts` for HP clamping, combat stage clamping, condition normalization, update context creation, and folder stripping.
- Extracted initiative tracker orchestration from `pages/maps/[slug].vue` into `composables/map-editor/useInitiativeTracker.ts`, including row derivation, sorting, HP bar helpers, sprite preview styles, turn/round controls, speed fill, clearing, and stale-active-id cleanup.
- The map page now wires initiative state through the composable while keeping the existing sidebar template and `IsometricGrid` props/events unchanged.
- Extracted Weather/Terrain/Room field-effect editor logic from the map page into `composables/map-editor/useFieldEffectsEditor.ts`, including palettes, active-state predicates, round parsing/ticking, clear-all behavior, and move-automation field-effect application.
- Added `tests/composables/map-editor/useFieldEffectsEditor.test.ts` covering round parsing, coexist weather, duration ticking/clearing, and move automation field effects.
- Quality gates after this phase:
  - `npm test` — passes: 8 test files / 24 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the pre-existing broader typecheck backlog; no errors are reported for the new map policy/use-case/sheet-mutation/initiative/field-effect files or touched map page lines.

## Next phase update: terrain and hazard builder extraction

- Extracted terrain builder state/actions from `pages/maps/[slug].vue` into `composables/map-editor/useTerrainBuilder.ts`.
  - Owns build mode/tool/material/color state, material filtering, voxel place/remove, fill-ground, and clear-all-terrain behavior.
- Extracted hazard builder state/actions from the map page into `composables/map-editor/useHazardBuilder.ts`.
  - Owns hazard mode/tool/kind state, palette/active definition, hazard place/remove, toxic-spikes layering, and clear-all-hazards behavior.
- Added shared `BuildTool` type in `shared/mapEditor.ts` and re-exported it from `components/IsometricGrid.client.vue` for compatibility.
- Added tests:
  - `tests/composables/map-editor/useTerrainBuilder.test.ts`
  - `tests/composables/map-editor/useHazardBuilder.test.ts`
- Quality gates after this phase:
  - `npm test` — passes: 10 test files / 30 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the pre-existing broader typecheck backlog; no errors are reported for the new terrain/hazard builder files, their tests, or touched map page lines.

## Next phase update: token controls and move automation panel extraction

- Extracted map token spawning/control behavior from `pages/maps/[slug].vue` into `composables/map-editor/useTokenControls.ts`.
  - Owns sheet lookups, spawned token derivation, player/GM controllable-token filtering, selection/preview state, sheet spawning, movement, turning, deletion, and token navigation path helpers.
- Extracted move automation panel orchestration into `composables/map-editor/useMoveAutomationPanel.ts`.
  - Owns active automation token state, move list derivation, transaction application, GM-gated map effect application, and capped move-log persistence in map metadata.
- Updated the map page to wire these composables while preserving existing `IsometricGrid`, `SheetBrowser`, and `MoveAutomationDialog` props/events.
- Added tests:
  - `tests/composables/map-editor/useTokenControls.test.ts`
  - `tests/composables/map-editor/useMoveAutomationPanel.test.ts`
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` was not rerun in this pass; the known broader pre-existing typecheck backlog remains documented above.

## Next phase update: initiative tracker component extraction

- Extracted the initiative tracker template and scoped styles from `pages/maps/[slug].vue` into `components/map/InitiativeTracker.vue`.
  - The component receives explicit rows/status props and emits focused turn, round, score, focus, and utility events.
  - Pure initiative row helpers remain in `composables/map-editor/useInitiativeTracker.ts` and are reused by the component.
- The map page now keeps only the route/sidebar shell wiring for the initiative sidebar.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: field effects panel extraction

- Extracted the Weather/Terrain/Room sidebar template and scoped styles from `pages/maps/[slug].vue` into `components/map/FieldEffectsPanel.vue`.
  - The component receives explicit palette/effect props and emits focused field-effect actions for weather, terrain, rooms, duration updates, coexist toggling, and clear/tick utilities.
  - Field-effect business logic remains in `composables/map-editor/useFieldEffectsEditor.ts`; the map page now only wires the composable to the panel.
- Reduced the map route page further while preserving `IsometricGrid` field-effect props and move-automation field-effect behavior.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: terrain and hazards panel extraction

- Extracted the terrain/hazard builder sidebar template and scoped styles from `pages/maps/[slug].vue` into `components/map/TerrainHazardsPanel.vue`.
  - The component receives explicit terrain, hazard, material, layer-visibility, and count props and emits focused editor actions.
  - Terrain/hazard business logic remains in `composables/map-editor/useTerrainBuilder.ts` and `composables/map-editor/useHazardBuilder.ts`; the map page now only wires those composables to the panel.
- Preserved existing build/hazard mode behavior, terrain material selection, custom color input, layer visibility toggles, fill/clear actions, and hazard palette controls.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: map details and admin panel extraction

- Extracted the map details/sidebar metadata editor from `pages/maps/[slug].vue` into `components/map/MapDetailsPanel.vue`.
  - The component receives explicit map name/dimensions/visibility props and emits focused visibility/dimension updates instead of mutating route-page state internally.
- Extracted the GM map control modal from the route page into `components/map/MapAdminPanel.vue`.
  - The component owns the modal markup/styles and emits close/ground-level updates while preserving the existing Ctrl+Shift+A shortcut wiring in the route page.
- Reduced `pages/maps/[slug].vue` below 1,000 lines and kept it focused on map loading, permissions, composable wiring, renderer events, and layout shell concerns.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for the new map details/admin panel components or touched map page lines.

## Next phase update: map scene panel extraction

- Extracted the center tabletop scene column from `pages/maps/[slug].vue` into `components/map/MapScenePanel.vue`.
  - The component owns the `ClientOnly` renderer shell, loading/not-found/error states, `IsometricGrid` event forwarding, and move automation dialog wiring.
  - It exposes `focusPokemon(id)` so the initiative tracker can keep focusing tokens without depending on the raw `IsometricGrid` component.
- The map route page no longer imports or renders `IsometricGrid` directly; it wires higher-level map editor state into the scene panel.
- Preserved existing renderer props/events, move automation apply/close behavior, loading copy, and map-not-found link behavior.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `MapScenePanel.vue` or touched map page lines.

## Next phase update: map sidebar shell extraction

- Extracted the left map editor sidebar into `components/map/MapLeftSidebar.vue`.
  - It owns the sidebar collapse control, app navigation/header/save indicator, map details panel, terrain/hazard panel, field-effects panel, and sheet browser wiring.
- Extracted the right initiative sidebar shell into `components/map/MapInitiativeSidebar.vue`.
  - The existing `components/map/InitiativeTracker.vue` remains the pure initiative panel; the new shell owns collapse/layout behavior.
- Added shared map editor UI types in `shared/mapEditor.ts` for editor mode and left-sidebar section keys.
- Reduced `pages/maps/[slug].vue` to a smaller route composition shell that wires composables to left sidebar, scene, right sidebar, and admin modal.
- Quality gates after this phase:
  - `npm test` — passes: 12 test files / 37 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for the new sidebar shell components, shared UI types, or touched map page lines.

## Next phase update: token sheet mutation composable extraction

- Extracted placed-token sheet mutation orchestration from `pages/maps/[slug].vue` into `composables/map-editor/useTokenSheetMutations.ts`.
  - The composable owns placement-to-sheet update lookup, optimistic local sheet commits, `/api/sheets/save` persistence payload construction, clientId inclusion, folder stripping, and rollback/logging on save failure.
  - HP, combat-stage, and condition map actions now flow through this focused composable instead of direct route-page `$fetch` and sheet mutation helper wiring.
- Added `tests/composables/map-editor/useTokenSheetMutations.test.ts` covering optimistic persistence payloads, rollback-on-save-failure, and control/`allowAnyTarget` behavior used by move automation.
- Reduced the map route page imports and kept sheet persistence details outside the route shell.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for the new token sheet mutation composable, its tests, or touched map page lines.

## Next phase update: isometric renderer material/texture extraction

- Began Phase 6 renderer decomposition by extracting renderer internals from `components/IsometricGrid.client.vue` into focused `utils/isometric/` modules:
  - `types.ts` for renderer object contracts and target types.
  - `materials.ts` for volume/voxel material construction and repainting.
  - `blockTextures.ts` for generated Minecraft-style voxel texture caching.
  - `spriteTextures.ts` for sprite/contact-shadow/halo texture acquisition and cache disposal.
  - `resourceDisposal.ts` for shared Three.js/CSS3D object cleanup.
- Kept `IsometricGrid.client.vue` as the compatibility adapter with the same public props/events while reducing it by roughly 1,000 lines.
- Tightened extracted Three.js sprite typings to match the current `three` event-map generic and kept the broader typecheck backlog unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `components/IsometricGrid.client.vue` or `utils/isometric/*`.

## Next phase update: isometric voxel renderer extraction

- Continued Phase 6 by extracting terrain voxel instancing and top-edge overlay rendering from `components/IsometricGrid.client.vue` into `utils/isometric/voxelRenderer.ts`.
  - The new renderer owns voxel bucket grouping, instanced mesh creation/disposal, terrain top-edge line overlay creation/disposal, visibility syncing, and raycast mesh exposure.
  - The Vue component now calls a narrow `voxelRenderer.sync/setVisible/meshes/dispose` interface instead of directly managing voxel mesh maps and overlay resources.
- Preserved build-mode and hazard-mode raycast behavior by keeping mesh `userData.voxels` payloads and exposing the same instanced mesh targets to existing picking logic.
- Reduced `IsometricGrid.client.vue` by another ~200 lines while keeping public props/events unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `components/IsometricGrid.client.vue` or `utils/isometric/*`.

## Next phase update: isometric hazard renderer extraction

- Continued Phase 6 by extracting hazard decal rendering from `components/IsometricGrid.client.vue` into `utils/isometric/hazardRenderer.ts`.
  - The new renderer owns hazard texture generation/caching, hazard decal mesh creation/disposal, layer offsets, visibility syncing, and raycast mesh exposure.
  - The Vue component now uses `hazardRenderer.sync/setVisible/meshes/dispose` while retaining hazard ghost previews and placement/erase interaction flow.
- Preserved hazard visual behavior, texture labels/layer numbers, per-cell offset stacking, `userData.hazard` picking payloads, and public `place-hazard`/`remove-hazard` events.
- Reduced `IsometricGrid.client.vue` by another ~200 lines while keeping public props/events unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `components/IsometricGrid.client.vue` or `utils/isometric/*`.

## Next phase update: isometric field-effect renderer extraction

- Continued Phase 6 by extracting weather/terrain/room field-effect rendering from `components/IsometricGrid.client.vue` into `utils/isometric/fieldEffectRenderer.ts`.
  - The new renderer owns weather particle/texture generation, terrain surface overlays, room boundary overlays, animation updates, visibility syncing, and disposal.
  - The Vue component now calls a narrow `fieldEffectRenderer.sync/update/setVisible/dispose` interface while continuing to pass normalized field effects, dimensions, terrain voxels, and ground level explicitly.
- Preserved existing weather visuals, terrain/room overlay behavior, renderer animation timing, and public `IsometricGrid` props/events.
- Reduced `IsometricGrid.client.vue` by another ~600 lines while keeping behavior unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `components/IsometricGrid.client.vue` or `utils/isometric/*`.

## Next phase update: isometric grid renderer extraction

- Continued Phase 6 by extracting floor grid, movement grid, and tabletop floor-plane ownership from `components/IsometricGrid.client.vue` into `utils/isometric/gridRenderer.ts`.
  - The new renderer owns grid geometry creation, visibility syncing, floor-plane access for build picking, and disposal.
  - The Vue component now calls `gridRenderer.sync/setVisible/floorPlane/dispose` while preserving build-target raycasting against the same floor plane.
- Preserved grid layer visibility, movement-grid visibility during token/build/hazard modes, floor-plane placement behavior, and public `IsometricGrid` props/events.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric build and hazard preview ghost extraction

- Continued Phase 6 by extracting build-mode voxel ghost and hazard decal ghost ownership from `components/IsometricGrid.client.vue` into `utils/isometric/previewGhosts.ts`.
  - The new preview ghost renderers own ghost mesh creation, material repainting, target updates, hide/show behavior, and disposal.
  - The Vue component now supplies only editor mode flags, selected hazard kind, and current build voxel style when updating previews.
- Preserved build/hazard preview colors, invalid/remove tinting, hazard texture swapping, placement offsets, and existing build/hazard pointer flows.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token HUD extraction

- Continued Phase 6 by extracting token elevation badges and HP/status HUD DOM helpers from `components/IsometricGrid.client.vue` into `utils/isometric/tokenHud.ts`.
  - The new module owns CSS3D elevation badge creation/update, HP bar construction, HP tiering, combat-stage chips, condition chips, held-item icons, active-turn state, and status-label sizing.
  - The Vue component now passes renderer state (`camera`, ground level, token centers, HP/combat/condition data) to focused HUD helpers instead of owning DOM mutation details inline.
- Preserved token HP/status/elevation visuals, active-turn chevrons, condition icons, held-item icons, and layer visibility behavior.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric world sprite extraction

- Continued Phase 6 by extracting WebGL sprite primitives from `components/IsometricGrid.client.vue` into `utils/isometric/worldSprites.ts`.
  - The new module owns sprite texture acquisition/cropping/animation, sprite asset swapping, ghost invalid-state tinting, directional halo lighting helpers, contact-shadow creation, sprite facing selection, and sprite disposal.
  - The Vue component now wires camera/facing context into `updateSpriteFacing` and keeps animation-loop orchestration while sprite internals live in a focused renderer utility.
- Preserved front/back sprite selection, animated sprite frame updates, ghost preview tinting, contact-shadow visuals, directional halo brightness, and sprite texture cache disposal behavior.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric token renderer extraction

- Continued Phase 6 by extracting live token render-object ownership from `components/IsometricGrid.client.vue` into `utils/isometric/tokenRenderer.ts`.
  - The new module owns token render-object construction, sync from `SpawnedPokemon`, per-frame positioning/HUD updates, selection styling, layer visibility, animation lighting/lift, and disposal.
  - The Vue component now keeps the render-object map and interaction wiring, but delegates token rendering lifecycle details to focused helpers.
- Preserved token sprite/front-back selection, HP/status/elevation HUD positioning, selection lift, contact-shadow scaling, proxy picking objects, and public `IsometricGrid` props/events.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric token move preview extraction

- Continued Phase 6 by extracting token movement preview ghost ownership from `components/IsometricGrid.client.vue` into `utils/isometric/tokenMovePreview.ts`.
  - The new renderer owns ghost sprite/halo setup, preview cage and elevation badge, path-line updates, invalid/reachable tinting, animation-facing updates, and preview disposal.
  - The Vue component keeps movement/pathfinding decisions and preview event emission while delegating preview rendering details.
- Preserved movement preview reachability, forced-placement invalid tinting, elevation badge behavior, path trail rendering, and ghost sprite lighting/front-back selection.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric camera controls extraction

- Continued Phase 6 by extracting isometric camera/renderer setup from `components/IsometricGrid.client.vue` into `utils/isometric/cameraControls.ts`.
  - The new module owns isometric angle constants, facing direction, camera/WebGL/CSS renderer creation, OrbitControls configuration, renderer resize/frustum syncing, grid alignment, max zoom calculation, and focus-on-token camera movement.
  - The Vue component now keeps only small wrappers that pass current props/DOM refs into the camera-control helpers.
- Preserved orthographic camera angle, zoom limits, renderer DOM styles, resize behavior, token focus behavior, and directional sprite-lighting facing vector.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric interaction target extraction

- Continued Phase 6 by extracting renderer pointer/raycast target resolution from `components/IsometricGrid.client.vue` into `utils/isometric/interactionTargets.ts`.
  - The new module owns pointer-to-raycaster conversion, token proxy picking, movement-grid plane intersection, terrain build target selection/validation, and hazard target selection/validation.
  - The Vue component now keeps only small wrappers that supply current renderer state, dimensions, occupancy sets, and emitted action handlers.
- Preserved token hover/click picking, movement preview plane picking, terrain pencil/eraser validity rules, hazard ground/voxel/decal picking, and hazard eraser validation.
- Quality gates after this phase:
  - `npm test` — passes: 13 test files / 40 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: PTU damage helper extraction

- Continued the large-component cleanup by extracting the `IsometricGrid` manual damage dialog's PTU damage-base table, DB rolling, and final HP-loss formula into `utils/ptuDamage.ts`.
  - Kept the manual dialog's existing damage-base values distinct from move automation's existing table to preserve current behavior.
  - The grid component now imports narrow damage helpers instead of owning roll/math rules inline.
- Added `tests/utils/ptuDamage.test.ts` covering deterministic DB rolls, formula formatting, defense/multiplier scaling, immunity, and PTU minimum-damage behavior.
- Quality gates after this phase:
  - `npm test` — passes: 15 test files / 44 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric token context-menu helper extraction

- Continued `IsometricGrid` cleanup by extracting token context-menu capability, button-count, height, and clamped position calculations into `utils/isometric/contextMenu.ts`.
  - The Vue component now creates menu state through a focused helper instead of knowing layout constants and token action capability rules inline.
  - Preserved existing menu actions, turn/Pokédex/delete button availability, and scene-bound clamping behavior.
- Added `tests/utils/isometric/contextMenu.test.ts` covering capability derivation, optional button counting, clamped positioning, and produced menu state shape.
- Quality gates after this phase:
  - `npm test` — passes: 16 test files / 47 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric shadow-surface helper extraction

- Continued renderer cleanup by extracting token shadow surface lookup from `components/IsometricGrid.client.vue` into `utils/isometric/shadows.ts`.
  - The new helper owns voxel-column bucketing and selecting the highest voxel top below a token footprint.
  - The Vue component now supplies rendered voxels and delegates shadow-surface math while preserving token shadow placement behavior.
- Added `tests/utils/isometric/shadows.test.ts` covering column grouping, highest-below-foot selection, and ground fallback behavior.
- Quality gates after this phase:
  - `npm test` — passes: 17 test files / 50 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.


## Next phase update: isometric lifecycle helper extraction

- Continued Phase 6 renderer decomposition by extracting DOM event binding, resize observer setup, and shared texture-cache disposal coordination into `utils/isometric/lifecycle.ts`.
  - The Vue component now keeps renderer lifecycle sequencing but delegates repetitive listener setup/cleanup and cache disposal to focused helpers.
  - Preserved pointer/context-menu/wheel handlers, non-passive wheel behavior, resize syncing, and the previous disposal order for sprite object resources vs. sprite texture caches.
- Added `tests/utils/isometric/lifecycle.test.ts` covering renderer DOM listener binding and cleanup.
- Quality gates after this phase:
  - `npm test` — passes: 18 test files / 51 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric HP dialog helper extraction

- Continued Phase 6 cleanup by extracting token HP dialog state creation, amount parsing, preview clamping, and live-token metadata syncing into `utils/isometric/tokenHpDialog.ts`.
  - `components/IsometricGrid.client.vue` now delegates HP dialog calculations to focused helpers while preserving the existing modify-HP modal UI and `modify-hp` event payload.
- Added `tests/utils/isometric/tokenHpDialog.test.ts` covering default dialog state, damage/heal deltas, invalid amount handling, HP clamping, and live-token sync behavior.
- Quality gates after this phase:
  - `npm test` — passes: 19 test files / 55 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric status dialog helper extraction

- Continued Phase 6 cleanup by extracting token combat-stage and condition dialog state helpers into `utils/isometric/tokenStatusDialogs.ts`.
  - `components/IsometricGrid.client.vue` now delegates combat-stage normalization/change detection, stage formatting/adjustment, condition normalization/change detection, and live-condition metadata syncing to focused helpers.
  - The combat-stage preview formatter is now an explicit import instead of an implicit template lookup.
- Added `tests/utils/isometric/tokenStatusDialogs.test.ts` covering combat-stage clamping/formatting/change detection and condition normalization/sync behavior.
- Quality gates after this phase:
  - `npm test` — passes: 20 test files / 59 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric damage dialog helper extraction

- Continued Phase 6 cleanup by extracting manual damage dialog state, attacker lookup/sorting, raw damage parsing, defense/attack bonus selection, type multiplier presentation, HP-loss preview calculation, DB lookup, and live-token metadata syncing into `utils/isometric/tokenDamageDialog.ts`.
  - `components/IsometricGrid.client.vue` now delegates damage math and dialog derivations to focused helpers while preserving the existing deal-damage modal UI and `modify-hp` event payload.
- Added `tests/utils/isometric/tokenDamageDialog.test.ts` covering default state, flat vs DB damage, attacker sorting/bonus lookup, type multiplier presentation, HP-loss preview, DB lookup, and live-token sync behavior.
- Quality gates after this phase:
  - `npm test` — passes: 21 test files / 64 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric movement preview helper extraction

- Continued Phase 6 cleanup by extracting token movement preview anchor/elevation calculations and the empty preview value into `utils/isometric/movementPreview.ts`.
  - `components/IsometricGrid.client.vue` now delegates grid-intersection-to-token-anchor clamping and mouse-wheel elevation stepping to focused pure helpers while preserving movement preview and forced-placement behavior.
- Added `tests/utils/isometric/movementPreview.test.ts` covering empty preview state, anchor clamping, out-of-bounds/oversized-token rejection, and elevation stepping at bounds.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token context menu component extraction

- Continued Phase 6 cleanup by extracting the token right-click action menu from `components/IsometricGrid.client.vue` into `components/isometric/TokenContextMenu.vue`.
  - The new component owns menu markup, styling, and focused action emits while the grid component keeps permission checks and token action orchestration.
- Preserved existing context-menu position state, action availability, delete gating, and action event flow.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token action dialog component extraction

- Continued Phase 6 cleanup by extracting token HP, combat-stage, condition, and manual-damage dialog markup/styles from `components/IsometricGrid.client.vue` into `components/isometric/TokenActionDialogs.vue`.
  - The new component owns dialog presentation, input focus exposure, combat-stage UI adjustments, DB roll UI state, and focused submit/close emits.
  - The grid component now keeps only token action permission checks and persistence/event orchestration for those dialogs.
- Preserved existing dialog copy, controls, clamping, DB roll behavior, input focus/select behavior, and emitted `modify-hp`/stage/condition payloads.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric HP dialog component extraction

- Continued token action dialog decomposition by extracting the modify-HP modal from `components/isometric/TokenActionDialogs.vue` into `components/isometric/TokenHpDialog.vue`.
  - Moved the shared token dialog CSS to `components/isometric/tokenActionDialog.css` so wrapper and child dialogs can share stable dialog styling without duplicating it.
  - `TokenActionDialogs.vue` now delegates HP input focus to the focused HP dialog component while retaining the same public expose API for `IsometricGrid`.
- Preserved existing HP dialog amount editing, damage/heal mode toggles, preview clamping display, cancel/apply events, and focus/select behavior.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric damage dialog component extraction

- Continued token action dialog decomposition by extracting the manual damage modal from `components/isometric/TokenActionDialogs.vue` into `components/isometric/TokenDamageDialog.vue`.
  - The damage component now owns damage-mode/source controls, type selection, attacker/DB roll UI, multiplier breakdown display, and damage input focus exposure.
  - `TokenActionDialogs.vue` is now a smaller coordinator for HP, status/conditions, and damage dialogs with the same expose API used by `IsometricGrid`.
- Preserved existing damage dialog copy, DB roll clearing/re-roll behavior, type multiplier display, attacker bonus breakdown, apply gating, and `modify-hp` submit flow.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric combat-stage dialog component extraction

- Continued token action dialog decomposition by extracting the combat-stage modal from `components/isometric/TokenActionDialogs.vue` into `components/isometric/TokenCombatStagesDialog.vue`.
  - The new component owns combat-stage row rendering, increment/decrement controls, input clamping, and apply/cancel events.
  - `TokenActionDialogs.vue` is now a smaller coordinator for HP, combat-stage, condition, and damage dialogs with combat-stage UI details isolated.
- Preserved existing combat-stage copy, clamping behavior, changed-state apply gating, and `modify-combat-stages` submit flow.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric conditions dialog component extraction

- Continued token action dialog decomposition by extracting the condition picker modal from `components/isometric/TokenActionDialogs.vue` into `components/isometric/TokenConditionsDialog.vue`.
  - The new component owns condition picker presentation, condition dialog copy, changed-state apply gating, and apply/cancel events.
  - `TokenActionDialogs.vue` now coordinates four focused dialog components instead of embedding action-specific modal markup.
- Preserved existing condition normalization/persistence flow in `IsometricGrid`, condition picker compact/tag sizing, and `modify-conditions` submit flow.
- Quality gates after this phase:
  - `npm test` — passes: 22 test files / 68 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token action controller extraction

- Extracted token context-menu and action-dialog orchestration from `components/IsometricGrid.client.vue` into `composables/isometric/useTokenActionController.ts`.
  - The composable owns context-menu state, HP/combat-stage/condition/damage dialog refs, derived dialog values, submit flows, live token metadata syncing, unauthorized-action cleanup, and Escape/topmost-overlay closing.
  - `IsometricGrid.client.vue` now wires renderer interactions to a focused controller instead of directly managing all token action state and persistence events inline.
- Added `tests/composables/isometric/useTokenActionController.test.ts` covering context action routing, HP/combat-stage/condition submissions, live metadata sync, unauthorized cleanup, and topmost overlay closing.
- Preserved existing public `IsometricGrid` events, context-menu action gating, dialog focus behavior, Escape close priority, and HP/stage/condition/damage submit payload shapes.
- Quality gates after this phase:
  - `npm test` — passes: 23 test files / 72 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `IsometricGrid.client.vue`, the new token action controller, or the new test.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric scene state helper extraction

- Extracted renderer scene-state helpers from `components/IsometricGrid.client.vue` into `utils/isometric/sceneState.ts`.
  - The new module owns default layer visibility resolution, movement-grid visibility rules, ground-level clamping, and field-effect/hazard/voxel revision-key construction.
  - `IsometricGrid.client.vue` now delegates renderer state normalization/revision logic to focused pure helpers while keeping renderer lifecycle wiring unchanged.
- Added `tests/utils/isometric/sceneState.test.ts` covering layer defaults, movement-grid visibility triggers, ground-level clamping, and revision keys for field effects, hazards, and terrain voxels.
- Preserved existing layer visibility behavior, movement-grid visibility during selection/build/hazard modes, ground-level bounds, and renderer sync revision semantics.
- Quality gates after this phase:
  - `npm test` — passes: 24 test files / 77 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run typecheck` — still fails only on the documented pre-existing broader typecheck backlog; no errors are reported for `IsometricGrid.client.vue` or the new scene-state helper/test.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric sprite lighting helper extraction

- Extracted camera-relative sprite brightness and directional halo-alpha calculations from `components/IsometricGrid.client.vue` into `utils/isometric/spriteLighting.ts`.
  - The new helper keeps the cage-light alignment math pure and testable while the grid component only consumes the computed per-frame brightness/halo values.
- Added `tests/utils/isometric/spriteLighting.test.ts` covering lit, shadowed, and zero-offset fallback alignment behavior.
- Preserved existing sprite brightness range, halo alpha range, directional light facing, and token/move-preview animation inputs.
- Quality gates after this phase:
  - `npm test` — passes: 25 test files / 80 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric build voxel helper extraction

- Extracted terrain-builder voxel preview style and placement payload construction from `components/IsometricGrid.client.vue` into `utils/isometric/buildVoxels.ts`.
  - The helper centralizes custom-color validation for previews while preserving the existing placement payload behavior for invalid custom colors and water default colors.
- Added `tests/utils/isometric/buildVoxels.test.ts` covering explicit custom colors, invalid preview colors, and deterministic water builder defaults.
- Preserved existing voxel placement events, material IDs, custom color handling, and default water block colors.
- Quality gates after this phase:
  - `npm test` — passes: 26 test files / 83 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric hazard placement helper extraction

- Extracted hazard placement payload construction from `components/IsometricGrid.client.vue` into `utils/isometric/hazardPlacement.ts`.
  - The helper owns the default hazard kind and toxic-spikes default layer behavior instead of keeping that event payload knowledge inline in the renderer component.
- Added `tests/utils/isometric/hazardPlacement.test.ts` covering standard hazards, toxic-spikes layer defaults, and fallback hazard kind behavior.
- Preserved existing `place-hazard` event payload shape and layer assignment semantics.
- Quality gates after this phase:
  - `npm test` — passes: 27 test files / 86 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric pointer travel helper extraction

- Extracted pointer-down/move travel tracking and click-threshold checks from `components/IsometricGrid.client.vue` into `utils/isometric/pointerTracker.ts`.
  - The renderer component now asks a focused tracker whether a pointer interaction should count as a click instead of managing drag-distance state inline.
- Added `tests/utils/isometric/pointerTracker.test.ts` covering travel accumulation, default threshold behavior, custom threshold behavior, and reset-on-new-pointer-start.
- Preserved the existing 6px click/drag threshold for left-click, terrain eraser, and hazard eraser interactions.
- Quality gates after this phase:
  - `npm test` — passes: 28 test files / 90 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric scene graph extraction

- Continued Phase 6 renderer decomposition by extracting the Three.js scene/group/raycaster/clock setup from `components/IsometricGrid.client.vue` into `utils/isometric/sceneGraph.ts`.
  - The helper owns the stable scene hierarchy for grid, world, preview, field-effect, voxel, and hazard containers.
  - The grid component now consumes a focused scene graph factory instead of constructing the render hierarchy inline.
- Added `tests/utils/isometric/sceneGraph.test.ts` covering top-level groups, world container ordering, and shared raycaster/clock exposure.
- Quality gates after this phase:
  - `npm test` — passes: 29 test files / 93 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric animation frame extraction

- Continued Phase 6 by extracting per-frame renderer stepping from `components/IsometricGrid.client.vue` into `utils/isometric/animationFrame.ts`.
  - The helper owns delta clamping, render-object interpolation, field-effect ticking, sprite-light calculation, token preview animation, and WebGL/CSS render calls.
  - The grid component now keeps only the requestAnimationFrame scheduling guard and passes explicit renderer dependencies into the frame step.
- Added `tests/utils/isometric/animationFrame.test.ts` covering delta clamping, token interpolation, field-effect updates, preview animation, renderer calls, and target snapping.
- Quality gates after this phase:
  - `npm test` — passes: 30 test files / 95 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric layer visibility helper extraction

- Continued Phase 6 by extracting renderer layer-visibility fan-out from `components/IsometricGrid.client.vue` into `utils/isometric/layerVisibility.ts`.
  - The helper centralizes movement-grid visibility derivation and applies terrain, field-effect, hazard, grid, and token visibility through narrow renderer interfaces.
  - The grid component now delegates subsystem visibility sync instead of repeating movement-grid conditions inline.
- Added `tests/utils/isometric/layerVisibility.test.ts` covering movement-grid visibility and subsystem/token visibility fan-out.
- Quality gates after this phase:
  - `npm test` — passes: 31 test files / 97 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric build interaction controller extraction

- Continued Phase 6 by extracting terrain build-mode pointer orchestration from `components/IsometricGrid.client.vue` into `utils/isometric/buildInteraction.ts`.
  - The controller owns build ghost preview replay, active tool/material/color lookup, valid placement payload creation, eraser removal routing, and inactive-mode ghost hiding through injected renderer/event callbacks.
  - The grid component now delegates terrain build interactions while retaining raycast target resolution and event emission boundaries.
- Added `tests/utils/isometric/buildInteraction.test.ts` covering inactive ghost hiding, preview target updates, valid voxel placement payloads, removal actions, invalid placement suppression, and replay gating.
- Quality gates after this phase:
  - `npm test` — passes: 32 test files / 102 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric hazard interaction controller extraction

- Continued Phase 6 by extracting hazard-mode pointer orchestration from `components/IsometricGrid.client.vue` into `utils/isometric/hazardInteraction.ts`.
  - The controller owns hazard ghost preview replay, active tool/kind lookup, valid placement payload construction, eraser removal routing, default-kind fallback, and inactive-mode ghost hiding through injected renderer/event callbacks.
  - The grid component now delegates hazard interactions while retaining raycast target resolution and public `place-hazard`/`remove-hazard` event boundaries.
- Added `tests/utils/isometric/hazardInteraction.test.ts` covering inactive ghost hiding, preview target updates, valid hazard placement payloads, removal actions, invalid placement suppression, default-kind fallback, and replay gating.
- Quality gates after this phase:
  - `npm test` — passes: 33 test files / 107 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token movement interaction controller extraction

- Continued Phase 6 by extracting selected-token movement preview state and commit orchestration from `components/IsometricGrid.client.vue` into `utils/isometric/tokenMovementInteraction.ts`.
  - The controller owns active preview state, pointer-to-anchor preview updates, path/reachability calculation, elevation wheel stepping, preview reset/refresh behavior, and guarded `move-pokemon` commits through injected renderer/event callbacks.
  - The grid component now delegates move-preview lifecycle decisions while retaining renderer raycast wiring and public `preview-change`/`move-pokemon` event boundaries.
- Added `tests/utils/isometric/tokenMovementInteraction.test.ts` covering pointer preview updates, renderer rejection cleanup, blocked/invalid previews, guarded move commits, elevation stepping, and state refresh/reset behavior.
- Quality gates after this phase:
  - `npm test` — passes: 34 test files / 113 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token hover controller extraction

- Continued Phase 6 by extracting hovered-token badge state from `components/IsometricGrid.client.vue` into `utils/isometric/tokenHover.ts`.
  - The controller owns hovered-id tracking, stale-token cleanup, repeated-hover suppression, and previous badge hiding through injected render-object lookup/update callbacks.
  - The module also exposes a focused hovered elevation-badge updater so the grid component no longer owns the badge DOM update details inline.
- Added `tests/utils/isometric/tokenHover.test.ts` covering hover tracking, active badge updates, previous badge hiding, repeated-id suppression, and stale-token clearing.
- Quality gates after this phase:
  - `npm test` — passes: 35 test files / 116 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token render-object sync extraction

- Continued Phase 6 by extracting live token render-object collection reconciliation from `components/IsometricGrid.client.vue` into `utils/isometric/tokenObjectSync.ts`.
  - The helper owns stale token disposal, hover cleanup before deletion, missing render-object creation, create-time positioning hooks, and per-token update fan-out through injected renderer lifecycle callbacks.
  - The grid component now keeps only the high-level sync call plus style refresh, while token object reconciliation is isolated and unit-tested.
- Added `tests/utils/isometric/tokenObjectSync.test.ts` covering creation/update order, existing-object reuse, stale disposal, hover cleanup, and map mutation behavior.
- Quality gates after this phase:
  - `npm test` — passes: 36 test files / 119 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric token selection style sync extraction

- Continued Phase 6 by moving selected-token render-object repaint fan-out into `utils/isometric/tokenObjectSync.ts`.
  - `components/IsometricGrid.client.vue` now delegates selection styling iteration to a focused helper and only applies layer visibility after the repaint pass.
  - Missing render objects are skipped consistently with the existing behavior.
- Expanded `tests/utils/isometric/tokenObjectSync.test.ts` to cover selection-state repainting and missing-object skips.
- Quality gates after this phase:
  - `npm test` — passes: 36 test files / 121 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric pointer interaction controller extraction

- Continued Phase 6 by extracting renderer pointer, wheel, right-click, hover-preview, and Escape-key routing from `components/IsometricGrid.client.vue` into `utils/isometric/pointerInteraction.ts`.
  - The new controller owns click-vs-drag gating, build/hazard eraser routing, token selection/menu routing, preview coordinate retention for replay, wheel elevation stepping, leave cleanup, and overlay-close priority.
  - The grid component now wires renderer-specific picking/actions into the controller through narrow callbacks while preserving public `select-pokemon`, `move-pokemon`, terrain, and hazard events.
- Added `tests/utils/isometric/pointerInteraction.test.ts` covering token selection/movement, build/hazard click routing, context-menu routing, pointer-move preview routing, wheel elevation, leave cleanup, and Escape handling.
- Quality gates after this phase:
  - `npm test` — passes: 37 test files / 126 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric renderer resource disposal extraction

- Continued Phase 6 by centralizing renderer-owned teardown sequencing in `disposeIsometricRendererResources` inside `utils/isometric/lifecycle.ts`.
  - The helper owns preview cleanup, subsystem disposal, shared cache disposal, token render-object disposal/clear, sprite texture cache disposal, grid/control/WebGL disposal, and CSS renderer DOM removal.
  - `components/IsometricGrid.client.vue` now delegates unmount resource teardown to one lifecycle helper while keeping window/listener cleanup in the Vue adapter.
- Expanded `tests/utils/isometric/lifecycle.test.ts` to cover renderer resource disposal and token render-object map clearing.
- Quality gates after this phase:
  - `npm test` — passes: 37 test files / 127 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: isometric scene watcher composable extraction

- Continued Phase 6 by extracting `IsometricGrid` reactive renderer watcher orchestration into `composables/isometric/useIsometricSceneWatchers.ts`.
  - The composable owns renderer-readiness gating, token/terrain/hazard/field-effect refresh fan-out, selection control cleanup, build/hazard mode transitions, settings replay, ground-level refreshes, and dimension resync sequencing.
  - `components/IsometricGrid.client.vue` is now under 800 lines and focuses on renderer construction, subsystem wiring, event callbacks, and template adapters.
- Added `tests/composables/isometric/useIsometricSceneWatchers.test.ts` covering selection guards, selection reset/cleanup behavior, build/hazard transitions, dimensions refresh, and readiness-gated token/terrain updates.
- Quality gates after this phase:
  - `npm test` — passes: 38 test files / 132 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon sheet derived helper extraction

- Began Phase 7/14 sheet-editor decomposition by moving Pokémon sheet derivation logic out of `data/characterSheets.ts` into `utils/sheets/pokemonDerived.ts`.
  - `data/characterSheets.ts` now focuses on static sheet discovery plus species/sprite catalog lookups.
  - Pokémon sheet pages, initiative speed derivation, and sheet spawning import stat/skill/capability/HP derivations from the focused utility module.
- Added `tests/utils/sheets/pokemonDerived.test.ts` covering stat resolution, HP formulas, base-relation validation, skill overrides/species defaults, and capability layering.
- Quality gates after this phase:
  - `npm test` — passes: 39 test files / 136 tests. (`npm test -- --runInBand` was attempted first and rejected by Vitest because that Jest flag is unsupported.)
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer sheet derived helper extraction

- Continued Phase 7/14 sheet-editor decomposition by moving trainer derivation logic out of `data/trainerSheets.ts` into `utils/sheets/trainerDerived.ts`.
  - `data/trainerSheets.ts` now focuses on static trainer JSON discovery and slug lookup.
  - Trainer sheet pages, initiative speed derivation, and sheet spawning import stat/skill/capability/AP/HP derivations from the focused utility module.
- Added `tests/utils/sheets/trainerDerived.test.ts` covering stat defaults/overrides, HP/AP formulas, skill background/overrides, capability defaults/options, and advancement row filling.
- Quality gates after this phase:
  - `npm test` — passes: 40 test files / 141 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: shared editable sheet resource composable

- Extracted duplicated Pokémon/trainer sheet page access and editable-resource wiring into `composables/sheets/useEditableSheetResource.ts`.
  - The composable owns player-access gating, deep JSON cloning, normalization, optional initial preparation, `useEditableSheet` creation, and default save-status/error computed values.
  - Pokémon and trainer sheet route pages now keep only slug/static-sheet lookup plus page-specific derived/editor logic.
- Added `tests/composables/sheets/useEditableSheetResource.test.ts` covering accessible clone creation, player access denial for GM-only sheets, and player access acceptance.
- Quality gates after this phase:
  - `npm test` — passes: 41 test files / 144 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer sheet CSV field extraction

- Continued Phase 7 sheet editor cleanup by extracting trainer CSV-backed field handling into focused modules:
  - `utils/sheets/csvFields.ts` for reusable parse/format/filter/single-or-list helpers.
  - `composables/sheets/useTrainerSheetCsvFields.ts` for trainer skill-background, capability, team, and wishlist CSV v-models.
- Updated the trainer sheet route page to use the composable instead of owning CSV parsing and setter branching inline.
- Added tests:
  - `tests/utils/sheets/csvFields.test.ts`
  - `tests/composables/sheets/useTrainerSheetCsvFields.test.ts`
- Quality gates after this phase:
  - `npm test` — passes: 43 test files / 150 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon sheet CSV field extraction

- Continued Phase 7 sheet editor cleanup by extracting Pokémon CSV-backed field handling into `composables/sheets/usePokemonSheetCsvFields.ts`.
  - The composable owns type, egg group, other capability, and skill-background comma-separated v-models while preserving species-derived display fallbacks for type and egg group fields.
- Updated the Pokémon sheet route page to consume the composable instead of owning CSV parsing/setter branching inline.
- Added `tests/composables/sheets/usePokemonSheetCsvFields.test.ts` covering derived fallback display, list updates, optional-field clearing, and null-sheet no-op behavior.
- Quality gates after this phase:
  - `npm test` — passes: 44 test files / 153 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer portrait picker composable

- Continued Phase 7 trainer sheet cleanup by extracting trainer portrait picker state and actions into `composables/sheets/useTrainerPortraitPicker.ts`.
  - The composable owns picker open/query state, catalog filtering by species/slug, portrait selection, and clearing while keeping the route page focused on wiring.
- Updated the trainer sheet route page to consume the portrait picker composable with the existing `trainerCatalog` source and preserve the modal/template behavior.
- Added `tests/composables/sheets/useTrainerPortraitPicker.test.ts` covering open/reset behavior, species/slug filtering, selection, clearing, and null-sheet no-op behavior.
- Quality gates after this phase:
  - `npm test` — passes: 45 test files / 156 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer sheet row action composable

- Continued Phase 7 trainer sheet cleanup by extracting row/action mutation helpers into `composables/sheets/useTrainerSheetRowActions.ts`.
  - The composable owns add/remove actions for classes, moves, abilities, maneuvers, orders, features, edges, inventory rows, advancement rows, tag CSV setters, stat/evasion edits, and skill override updates.
- Updated the trainer sheet route page to wire the composable instead of owning row mutation implementation details inline.
- Added `tests/composables/sheets/useTrainerSheetRowActions.test.ts` covering row add/remove flows, advancement upserts, tag parsing, stat/evasion edits, skill override cleanup, and null-sheet no-op behavior.
- Quality gates after this phase:
  - `npm test` — passes: 46 test files / 161 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon sheet row action composable

- Continued Phase 7 Pokémon sheet cleanup by extracting row/action mutation helpers into `composables/sheets/usePokemonSheetRowActions.ts`.
  - The composable owns held-item name persistence cleanup, move/ability/edge row actions, stat edits, evasion bonus coercion, and inherited-move updates.
- Updated the Pokémon sheet route page to wire the composable instead of owning row mutation implementation details inline.
- Added `tests/composables/sheets/usePokemonSheetRowActions.test.ts` covering row add/remove flows, held-item lookup-field stripping, stat/evasion edits, inherited moves, and null-sheet no-op behavior.
- Quality gates after this phase:
  - `npm test` — passes: 47 test files / 165 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon sheet derived composable

- Continued Phase 7 sheet editor cleanup by extracting Pokémon sheet derived UI state into `composables/sheets/usePokemonSheetDerived.ts`.
  - The composable now owns species/sprite fallbacks, stat/skill/capability rows, HP clamping, evasion/item bonuses, move/ability lookup rows, type effectiveness rows, tutor points, and base-relation summary state.
- Updated `pages/sheets/[slug].vue` to consume the derived composable instead of owning those calculations inline.
- Added `tests/composables/sheets/usePokemonSheetDerived.test.ts` covering species fallbacks, HP clamping, Bright Powder evasion, lookup rows, type effectiveness, and lookup-list formatting.
- Quality gates after this phase:
  - `npm test` — passes: 48 test files / 168 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer sheet derived composable

- Continued Phase 7 sheet editor cleanup by extracting trainer sheet derived UI state into `composables/sheets/useTrainerSheetDerived.ts`.
  - The composable owns trainer stat/skill/capability/advancement rows, HP/AP summaries, current-HP clamping, move/ability lookup rows, evasion totals, HP thresholds, and stat-point summaries.
- Updated `pages/sheets/trainers/[slug].vue` to consume the derived composable instead of owning those calculations inline.
- Added `tests/composables/sheets/useTrainerSheetDerived.test.ts` covering trainer row derivation, vitals, HP clamping, lookup rows, evasion, and stat-point totals.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon identity panel component

- Continued Phase 7 Pokémon sheet page decomposition by extracting the identity strip into `components/sheets/PokemonIdentityPanel.vue`.
  - The component owns sprite/name/species/type/nature/scene identity markup and scoped styles while receiving explicit sheet, option, and derived-display props.
- Updated `pages/sheets/[slug].vue` to wire the identity panel with named `v-model`s for type and egg-group CSV fields.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer identity panel component

- Continued Phase 7 trainer sheet page decomposition by extracting the identity/vitals strip into `components/sheets/TrainerIdentityPanel.vue`.
  - The component owns portrait tile interactions, trainer identity fields, player toggle, HP/AP/injury/money vitals, and the moved scoped styles with explicit props and emits.
- Updated `pages/sheets/trainers/[slug].vue` to wire portrait-picker and current-HP actions through the component instead of embedding identity markup inline.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon stats and combat panel extraction

- Continued Phase 7 Pokémon sheet page decomposition by extracting the stats table/base-relation validation into `components/sheets/PokemonStatsPanel.vue`.
- Extracted Pokémon combat, HP thresholds, evasion bonuses, conditions, vitamins, and combat notes into `components/sheets/PokemonCombatPanel.vue`.
- Updated `pages/sheets/[slug].vue` to wire focused props/emits into those panels while preserving editable-cell mutations, HP clamping, evasion bonus coercion, and condition picker behavior.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon equipment and training panel extraction

- Continued Phase 7 Pokémon sheet page decomposition by extracting held-item lookup details and weapon editing into `components/sheets/PokemonEquipmentPanel.vue`.
- Extracted tutor points, skill-background CSV fields, and inherited move editing into `components/sheets/PokemonTrainingPanel.vue`.
- Updated `pages/sheets/[slug].vue` to wire focused `v-model`s and emits into those panels while preserving item lookup display, held-item persistence cleanup, weapon editing, tutor-point totals, and inherited-move clearing behavior.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: remaining Pokémon sheet panels extraction

- Completed the main Pokémon sheet route-page decomposition by extracting the remaining body sections into focused components:
  - `components/sheets/PokemonMovesPanel.vue`
  - `components/sheets/PokemonTypeEffectivenessPanel.vue`
  - `components/sheets/PokemonCapabilitiesPanel.vue`
  - `components/sheets/PokemonAbilitiesEdgesPanel.vue`
  - `components/sheets/PokemonSkillsPanel.vue`
- Updated `pages/sheets/[slug].vue` to act as a composition shell for Pokémon sheet access, derived state, row-action wiring, and panel rendering.
- Preserved lookup-backed move/ability name cleanup, automatic Struggle display, type-effectiveness rows, capabilities CSV editing, edge row actions, and species-given skill override behavior.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer stats/background/skills panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting focused trainer-tab panels:
  - `components/sheets/TrainerStatsPanel.vue` for stat rows and trainer stat-point budget display.
  - `components/sheets/TrainerSkillBackgroundPanel.vue` for skill-background CSV fields and milestone counters.
  - `components/sheets/TrainerSkillsPanel.vue` for skill rank/modifier editing and raised/lowered styling.
- Updated `pages/sheets/trainers/[slug].vue` to wire those panels through explicit props, `v-model`s, and emits, and removed now-dead inline style blocks for the extracted trainer sections.
- Preserved stat mutation behavior, skill-background CSV persistence, skill rank/modifier cleanup, and displayed stat-point totals.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer progress panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting trainer classes, training feature, advancement, team/wishlist, and narrative blocks into `components/sheets/TrainerProgressPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to wire the progress panel through explicit props, `v-model`s, and emits while preserving class row actions, advancement edits, team links, wishlist editing, and narrative textareas.
- Removed now-dead route-page styles for the extracted class and narrative sections.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer combat overview panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting combat vitals, Action Points, evasion/conditions, digestion, and trainer capabilities into `components/sheets/TrainerCombatOverviewPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to pass explicit derived combat totals and HP/evasion actions into the panel while preserving current HP clamping, AP edits, evasion bonus bounds, condition picker behavior, and capability CSV editing.
- Removed now-dead route-page styles/imports for the extracted combat overview sections.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer combat actions panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting movelist, abilities, maneuvers, and Pokémon Training/Orders into `components/sheets/TrainerCombatActionsPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to wire move/ability lookup rows and row-action emits through the new panel while preserving lookup-backed name cleanup, damage/type display, maneuver category selection, and order tag CSV editing.
- Removed now-dead route-page imports/constants/styles for the extracted combat action sections.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer inventory panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting equipped gear and all trainer inventory tables into `components/sheets/TrainerInventoryPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to wire inventory add/remove actions through focused panel emits while preserving equipment slot sprite previews, inventory item sprite previews, quantity/cost/mod/slot edits, and empty-state rows.
- Removed now-dead route-page styles for equipped gear, inventory item names, and key/value inventory lists.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer feature and edge panel extraction

- Continued Phase 7 trainer sheet page decomposition by extracting the remaining feature and edge tab tables into `components/sheets/TrainerFeaturesPanel.vue` and `components/sheets/TrainerEdgesPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to wire focused add/remove/tag emits into those panels while preserving editable-cell behavior, feature tag CSV persistence, empty states, and row removal controls.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer portrait picker modal extraction

- Continued Phase 7 trainer sheet page decomposition by extracting the trainer portrait picker modal into `components/sheets/TrainerPortraitPickerModal.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to pass the picker query, filtered catalog options, selected portrait URL, and close/select actions through explicit props/emits.
- Removed now-dead portrait picker and table-control styles from the route page, keeping portrait lookup/filter state in `useTrainerPortraitPicker` and presentation in the modal component.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: shared sheet tab nav extraction

- Extracted the trainer sheet tab navigation into `components/sheets/SheetTabNav.vue` with explicit tab props and an `update:activeKey` emit.
- Updated `pages/sheets/trainers/[slug].vue` to route tab changes through a small validated setter while preserving the existing tab keys, labels, active styling, and tab visibility behavior.
- Removed now-dead tab button styles from the route page so tab presentation lives with the reusable nav component.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer overview tab extraction

- Continued Phase 7 trainer sheet page decomposition by extracting the Trainer tab composition into `components/sheets/TrainerMainTabPanel.vue`.
- The new tab panel coordinates stats, skill-background CSV fields, skills, classes, advancement, team, wishlist, and narrative subpanels through explicit props, `v-model`s, and emits.
- Updated `pages/sheets/trainers/[slug].vue` to wire the focused tab component and removed a dead `addAdvancement` route-page binding plus unused grid styles.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer combat tab extraction

- Continued Phase 7 trainer sheet page decomposition by extracting the Combat tab composition into `components/sheets/TrainerCombatTabPanel.vue`.
- The new tab panel coordinates combat overview vitals, capabilities, move/ability/maneuver/order tables, order tag CSV edits, and combat row actions through explicit props, `v-model`, and emits.
- Updated `pages/sheets/trainers/[slug].vue` to wire combat derived values and row actions into the focused tab component while preserving current HP, evasion bonus, move lookup, ability lookup, maneuver, and order editing behavior.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer inventory tab shell extraction

- Finished the trainer tab-shell extraction by wrapping the Inventory tab in `components/sheets/TrainerInventoryTabPanel.vue`.
- Updated `pages/sheets/trainers/[slug].vue` to use focused tab components for every trainer sheet tab and removed the final route-page tab-panel style.
- Preserved existing inventory add/remove behavior and kept `TrainerInventoryPanel.vue` responsible for the detailed inventory/equipment table presentation.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: shared sheet page shell

- Extracted duplicated Pokémon/trainer sheet page chrome into `components/sheets/SheetPageShell.vue`.
  - The shell owns app navigation, back link, save indicator placement, page spacing, and found/not-found slot layout.
- Updated Pokémon and trainer sheet route pages to use the shared shell while preserving their existing editor panels, save status wiring, and not-found copy.
- Quality gates after this phase:
  - `npm test` — passes: 49 test files / 171 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon nature control composable

- Extracted Pokémon nature/gender option wiring, nature display formatting, and `natureMod` synchronization into `composables/sheets/usePokemonNatureControls.ts`.
- Updated the Pokémon sheet route page to consume the focused composable instead of owning nature lookup, formatting, and watcher details inline.
- Added `tests/composables/sheets/usePokemonNatureControls.test.ts` for nature step sizes, display labels, persisted `natureMod` syncing, and reactive option/display behavior.
- Quality gates after this phase:
  - `npm test` — passes: 50 test files / 174 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer tab state composable

- Extracted trainer sheet tab definitions, key validation, and active-tab state into `composables/sheets/useTrainerSheetTabs.ts`.
- Updated the trainer sheet route page to consume the tab composable instead of owning tab constants and validation inline.
- Added `tests/composables/sheets/useTrainerSheetTabs.test.ts` covering tab order, key validation, and guarded active-tab updates.
- Quality gates after this phase:
  - `npm test` — passes: 51 test files / 177 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokémon sheet editor component extraction

- Extracted Pokémon sheet editor orchestration and panel composition into `components/sheets/PokemonSheetEditor.vue`.
  - The editor component now owns Pokémon derived state, nature controls, CSV-backed fields, row-action wiring, and panel layout.
- Reduced `pages/sheets/[slug].vue` to a route shell for slug lookup, editable-resource access, page metadata, shared sheet chrome, and not-found handling.
- Preserved Pokémon sheet autosave/resource wiring, player-access behavior, panel props/events, and nature `natureMod` synchronization.
- Quality gates after this phase:
  - `npm test` — passes: 51 test files / 177 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: trainer sheet editor component extraction

- Extracted trainer sheet editor orchestration and tab/panel composition into `components/sheets/TrainerSheetEditor.vue`.
  - The editor component now owns trainer derived state, tab state, CSV-backed fields, row-action wiring, and portrait picker behavior.
- Reduced `pages/sheets/trainers/[slug].vue` to a route shell for trainer lookup, editable-resource access, page metadata, shared sheet chrome, and not-found handling.
- Preserved trainer sheet autosave/resource wiring, player-access behavior, portrait picker behavior, tab keys, and all panel props/events.
- Quality gates after this phase:
  - `npm test` — passes: 51 test files / 177 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: shared sheet not-found card

- Extracted duplicated Pokémon/trainer missing-sheet presentation into `components/sheets/SheetNotFoundCard.vue`.
- Updated both sheet route shells to use the shared not-found card and removed their remaining route-local presentation styles.
- Preserved existing missing-sheet titles, slug display, and return-to-sheets navigation behavior.
- Quality gates after this phase:
  - `npm test` — passes: 51 test files / 177 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex search-text helper extraction

- Began the next cleanup pass on the remaining large Pokédex route by extracting field configuration, text normalization, slug formatting, and search-index bucket construction into `utils/pokedex/searchText.ts`.
- Updated `pages/pokedex/[[pokemon_name]].vue` to import the focused search helpers while preserving existing route URLs, filtering fields, and display formatting.
- Added `tests/utils/pokedex/searchText.test.ts` covering normalization, compact aliases, national-dex labels, and representative field-specific search buckets.
- Quality gates after this phase:
  - `npm test` — passes: 52 test files / 180 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex search-query helper extraction

- Extracted advanced Pokédex boolean search parsing and field-filter matching into `utils/pokedex/searchQuery.ts`.
- Kept the route page responsible only for Nuxt state/computed wiring while the parser now owns normalization, tokenization, implicit-AND behavior, NOT/dash exclusions, and multi-field operator matching.
- Added `tests/utils/pokedex/searchQuery.test.ts` covering operator tokenization, dash exclusion normalization, compact-term matching, and field filter combination semantics.
- Quality gates after this phase:
  - `npm test` — passes: 53 test files / 184 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex entry index extraction

- Extracted Pokédex display-entry creation, slug lookup map construction, route-param slug normalization, and entry path formatting into `utils/pokedex/entryIndex.ts`.
- The route page now consumes a prepared entry index instead of owning static data sorting, National Dex number lookup, duplicate-slug handling, and copied-URL underscore normalization inline.
- Added `tests/utils/pokedex/entryIndex.test.ts` covering empty-record filtering, National Dex ordering, search text attachment, duplicate slug retention, and route/path formatting.
- Quality gates after this phase:
  - `npm test` — passes: 54 test files / 187 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex entry detail helper extraction

- Extracted selected-entry display derivations into `utils/pokedex/entryDetails.ts`, including placement-only detection, gender/vital summaries, capability tokens, move tokens, skill phrase formatting, list summaries, and page-number fallback behavior.
- Updated the Pokédex route to keep only computed wiring around those pure helpers while preserving the existing template data shapes.
- Added `tests/utils/pokedex/entryDetails.test.ts` covering identity/vital summaries, movement capability tokens, TM/HM/Egg/Tutor move tokens, skills, breeding/diet/habitat summaries, and page-number resolution.
- Quality gates after this phase:
  - `npm test` — passes: 55 test files / 190 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex type matchup helper extraction

- Extracted PTU type multiplier calculation, multiplier label formatting, and weakness/resistance/immunity grouping into `utils/pokedex/typeMatchups.ts`.
- The Pokédex route now delegates type-chart math to a pure utility and only computes matchup groups for the selected entry.
- Added `tests/utils/pokedex/typeMatchups.test.ts` covering PTU effectiveness-step scaling, label formatting, grouping/sorting basics, immunities, and invalid type filtering.
- Quality gates after this phase:
  - `npm test` — passes: 56 test files / 193 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex sidebar scroll composable extraction

- Extracted Pokédex sidebar/list scroll persistence into `composables/pokedex/usePokedexSidebarScroll.ts`.
- The route page now delegates Nuxt route-update, mount/unmount, and restore-after-navigation wiring to a focused composable while preserving existing scroll restoration behavior between `/pokedex` routes.
- Added `tests/composables/pokedex/usePokedexSidebarScroll.test.ts` for the path predicate that gates Pokédex-only scroll preservation.
- Quality gates after this phase:
  - `npm test` — passes: 57 test files / 194 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex filter-state composable extraction

- Extracted Pokédex filter mode/search text/operator state, active filter construction, and filtered-entry derivation into `composables/pokedex/usePokedexFilters.ts`.
- The route page now wires the filter UI to a focused composable while pure helpers own default state creation, advanced-vs-field filter parsing, and entry filtering.
- Added `tests/composables/pokedex/usePokedexFilters.test.ts` covering default state, active filter construction, no-filter identity preservation, and field filtering behavior.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex sidebar component extraction

- Extracted the Pokédex filter controls, entry list, sidebar scroll refs, and sidebar-specific styles from `pages/pokedex/[[pokemon_name]].vue` into `components/pokedex/PokedexSidebar.vue`.
- The route page now wires the filter composable into the sidebar through explicit props/`v-model` while the component owns scroll persistence via `usePokedexSidebarScroll`.
- Preserved existing field/advanced filtering UI, entry active states, scroll restoration, routes, type badges, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex entry detail component extraction

- Extracted the Pokédex detail article, empty-state presentation, and book-style detail CSS from `pages/pokedex/[[pokemon_name]].vue` into `components/pokedex/PokedexEntryDetail.vue` plus `components/pokedex/pokedexDetail.css`.
- The route page is now a smaller browser shell that prepares route/filter/selected-entry state and passes explicit display props to the detail component.
- Preserved existing selected-entry layout, not-found copy, sprite rendering, badges, moves, type matchups, evolutions, and responsive book layout.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex profile column extraction

- Extracted the left-side Pokédex profile column into `components/pokedex/PokedexProfileColumn.vue` with explicit entry, sprite, evolution, size, breeding, diet, and habitat props.
- Added `components/pokedex/types.ts` for the displayed evolution DTO shared by Pokédex detail components.
- `PokedexEntryDetail.vue` now delegates sprite/base-stat/basic-info/evolution/size/breeding sections to the focused profile column while preserving shared book styles.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex move list panel extraction

- Extracted the Pokédex move-list section into `components/pokedex/PokedexMoveListPanel.vue` with explicit level-up, TM/HM, Egg, and Tutor move token props.
- `PokedexEntryDetail.vue` now delegates all move rendering to the focused panel while preserving shared book CSS and existing RefLink/TypeBadge output.
- Preserved level-up move rows, comma-separated TM/HM/Egg/Tutor lists, empty-section gating, and move link display text.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex type matchup panel extraction

- Extracted the defensive type matchup section into `components/pokedex/PokedexTypeMatchupsPanel.vue` with a narrow `TypeMatchupGroup[]` prop.
- `PokedexEntryDetail.vue` now delegates matchup chip rendering while keeping type-chart computation in the existing pure `utils/pokedex/typeMatchups.ts` helper.
- Preserved matchup grouping, sorting output, type badges, multiplier chips, and empty-section gating.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex capabilities and skills panel extraction

- Extracted the Capability List and Skill List sections into `components/pokedex/PokedexCapabilitiesSkillsPanel.vue` with narrow capability-token and skill-phrase props.
- `PokedexEntryDetail.vue` now composes profile, capabilities/skills, type matchups, and move list panels inside the book layout.
- Preserved capability RefLink fallback behavior, comma separation, skill phrase display, and empty-section gating.
- Quality gates after this phase:
  - `npm test` — passes: 58 test files / 197 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: Pokédex browser composable extraction

- Extracted route selection, requested-name handling, page-title formatting, displayed-evolution DTO construction, filter wiring, selected sprite lookup, and selected-entry derivations into `composables/pokedex/usePokedexBrowser.ts`.
- Moved the displayed evolution DTO type into `utils/pokedex/entryDetails.ts` so page/composable/components share it without component-to-component type coupling.
- Reduced `pages/pokedex/[[pokemon_name]].vue` to a route shell that sets page metadata, calls the browser composable, and wires sidebar/detail components.
- Added `tests/composables/pokedex/usePokedexBrowser.test.ts` covering routed selection, missing-route labels, displayed evolution links/self-link suppression, and page title formatting.
- Quality gates after this phase:
  - `npm test` — passes: 59 test files / 201 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769`.

## Next phase update: shared folder browser helpers

- Extracted repeated maps/sheets folder-browser primitives into `utils/folderBrowser.ts`.
  - The helper now owns route-query folder normalization, breadcrumbs, child-folder tile derivation/counting, search normalization, folder move validation/path calculation, and `new_folder` leaf allocation.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to consume the shared helpers while preserving route query behavior, folder tiles, search filtering, drag/drop no-op checks, and default folder naming.
- Added `tests/utils/folderBrowser.test.ts` covering query/search normalization, breadcrumbs, child folder counting, folder allocation, and move validation.
- Quality gates after this phase:
  - `npm test` — passes: 60 test files / 207 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared folder move destination helpers

- Extended `utils/folderBrowser.ts` with focused folder path primitives for parent lookup, prefix renaming, context-menu move destination filtering, and destination label creation.
- Updated the maps and sheets library pages to use the shared destination/prefix helpers for drag/drop follow-up state, realtime folder-move handling, folder rename navigation, and Move context-menu options.
- Expanded `tests/utils/folderBrowser.test.ts` to cover prefix renames, parent no-op filtering, item move destinations, and formatted destination labels.
- Quality gates after this phase:
  - `npm test` — passes: 60 test files / 208 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library realtime state helpers

- Extracted maps-index list state transformations into `utils/mapLibrary.ts`.
  - The helper now owns TabletopMap-to-summary conversion, local folder delete/move collection updates, and `maps` realtime event application with clientId echo suppression.
- Updated `pages/maps/index.vue` to delegate realtime synchronization, local folder move/delete updates, and newly-created map summaries to the focused utility module.
- Added `tests/utils/mapLibrary.test.ts` covering summary conversion, folder delete/move updates, realtime create/update/move/rename/delete/folder events, malformed payloads, wrong channels, and local echo suppression.
- Quality gates after this phase:
  - `npm test` — passes: 61 test files / 213 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library item derivation helpers

- Extracted sheets-index item/domain derivation into `utils/sheetLibrary.ts`.
  - The helper now owns Pokémon/trainer list-item construction, display names, local folder/name/deletion override application, deleted-folder filtering, folder-set derivation, and search matching.
- Updated `pages/sheets/index.vue` to consume the sheet-library helpers while preserving player-only filtering, local drag/drop rename overrides, soft-deletes, folder tiles, and search behavior.
- Added `tests/utils/sheetLibrary.test.ts` covering item construction, species type/sprite fallback wiring, override application, player/deleted filtering, folder-set construction, and Pokémon/trainer search fields.
- Quality gates after this phase:
  - `npm test` — passes: 62 test files / 219 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter table browser helpers

- Extracted encounter-table sidebar filtering and selection primitives into `utils/encounterTables.ts`.
  - The utility now owns normalized search, region grouping, field/species matching, selected-entry lookup, first-entry selection, and filtered-count aggregation.
- Updated `pages/encounter-tables.vue` to use those pure helpers while preserving region/table/species search behavior, selected-table routing links, and displayed entry rows.
- Added `tests/utils/encounterTables.test.ts` covering search normalization, selection helpers, region grouping, formatted region label matching, table key/name matching, species matching, and filtered counts.
- Quality gates after this phase:
  - `npm test` — passes: 63 test files / 222 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generation helpers

- Extracted encounter generator form/request primitives into `utils/encounterGeneration.ts`.
  - The helper now owns count clamping, default form constants, initial route-query selection, table-key coercion, `/api/encounters/generate` request-body construction, open-file toggling, response types, and error-message normalization.
- Updated `pages/generate.vue` to consume those focused helpers while preserving URL-driven region/table defaults, preview roll count clamping, generated-file toggles, request shape, and error display behavior.
- Added `tests/utils/encounterGeneration.test.ts` covering count bounds, fallback/query selection, table-key coercion, request body construction, open-file set toggling, and common fetch error shapes.
- Quality gates after this phase:
  - `npm test` — passes: 64 test files / 228 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation dialog helper extraction

- Extracted pure move-automation dialog calculations into `utils/moveAutomationDialog.ts`.
  - The helper now owns non-negative integer parsing, HP suggestion application, combat-stage delta clamping/filtering, hazard cell text parsing, and compact stage delta labels.
- Updated `components/MoveAutomationDialog.vue` to import those focused helpers while preserving manual HP-loss overrides, scripted HP suggestions, combat-stage transaction output, hazard placement parsing, and UI stage labels.
- Added `tests/utils/moveAutomationDialog.test.ts` covering parsing, HP heal/loss bounds, combat-stage clamping, non-zero stage delta extraction, hazard coordinate parsing with fallback Y, and stage label formatting.
- Quality gates after this phase:
  - `npm test` — passes: 65 test files / 234 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation transaction builder extraction

- Extracted move-automation transaction assembly from `components/MoveAutomationDialog.vue` into `utils/moveAutomationTransaction.ts`.
  - The helper owns suggestion keys, default target-resolution state, damage loss/multiplier derivation, HP suggestion amounts, condition/stage merging, hazards, field effects, and log-line construction.
  - `MoveAutomationDialog` now keeps wizard UI state and delegates transaction/domain calculations through narrow helper calls.
- Added `tests/utils/moveAutomationTransaction.test.ts` covering suggestion keys, resolution defaults, damage overrides/type immunities, HP suggestion amounts, multiplier labels, and full transaction assembly.
- Quality gates after this phase:
  - `npm test` — passes: 66 test files / 238 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation move/target helper extraction

- Extracted move-list and target-selection derivations from `components/MoveAutomationDialog.vue` into `utils/moveAutomationMoves.ts`.
  - The helper now owns sheet-move-to-move-entry construction, move search filtering, selected-entry fallback, target sorting/lookup, target-required detection, and target-id toggling rules.
  - The dialog component now focuses more narrowly on wizard state, rolls, and UI event wiring.
- Added `tests/utils/moveAutomationMoves.test.ts` covering move-entry construction/filtering, selected-entry fallback, target sorting/lookup, target-required checks, and target toggle limits.
- Quality gates after this phase:
  - `npm test` — passes: 67 test files / 244 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation resolution state helper extraction

- Extracted move-automation resolution-state primitives from `components/MoveAutomationDialog.vue` into `utils/moveAutomationResolution.ts`.
  - The helper now owns resolution record clearing/syncing, default suggestion enablement, combat-stage delta reset, self-target reset behavior, d20/accuracy roll results, damage roll storage, and roll-all orchestration.
  - The dialog component now delegates target-resolution lifecycle and rolling mechanics while retaining UI-specific refs and event handlers.
- Added `tests/utils/moveAutomationResolution.test.ts` covering record reset, d20/accuracy behavior, target-resolution sync, default suggestion flags, self-target reset, and roll-all flows.
- Quality gates after this phase:
  - `npm test` — passes: 68 test files / 250 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generation page composable extraction

- Extracted `/generate` route state and orchestration into `composables/encounters/useEncounterGenerationPage.ts`.
  - The composable owns URL/query initialization, region/table synchronization, preview rolling, generation request execution, error normalization, generated-file expansion state, and route-query updates through injected dependencies.
  - `pages/generate.vue` now focuses on page metadata and template rendering while preserving existing form fields, URL behavior, preview rolling, and `/api/encounters/generate` request shape.
- Added `tests/composables/encounters/useEncounterGenerationPage.test.ts` covering query initialization, automatic preview rolls, region/table coercion with route replacement, generation success/error handling, request count clamping, and file expansion toggles.
- Quality gates after this phase:
  - `npm test` — passes: 69 test files / 255 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter table browser composable extraction

- Extracted `/encounter-tables` browser state into `composables/encounters/useEncounterTableBrowser.ts`.
  - The composable owns search term state, region/table filtering, selected entry state/actions, selected row derivation, and count summaries.
  - `pages/encounter-tables.vue` now focuses on metadata and presentation while preserving table selection, search behavior, generated-link URLs, and displayed roll rows.
- Added `tests/composables/encounters/useEncounterTableBrowser.test.ts` covering initial selection, search filtering by species/region, selection updates, row formatting, and empty collection behavior.
- Quality gates after this phase:
  - `npm test` — passes: 70 test files / 259 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: server encounter generation helper extraction

- Extracted server-side encounter generation request/path/roll primitives into `server/utils/encounterGeneration.ts`.
  - The helper now owns region/table/outRoot sanitization, count validation, request normalization, safe table-path construction, project-root path assertions, slug-prefix formatting, table rolling, and unique output folder allocation.
  - `server/api/encounters/generate.post.ts` now delegates validation and path/roll mechanics while preserving GM auth, pokegen execution order, preview cleanup behavior, and response shape.
- Added `tests/server/encounterGeneration.test.ts` covering safe name/outRoot validation, count/request normalization, slug/path helpers, root containment checks, deterministic table rolling, and output folder allocation.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generate result card extraction

- Extracted the generated/preview result presentation from `pages/generate.vue` into `components/encounters/EncounterGenerateResultCard.vue`.
  - The component owns result heading badges, generated-folder hint, generated file list, preview file expansion controls, error rows, and result-specific styles.
  - The generate route now wires result state/open-file state through explicit props and emits while preserving file expansion behavior and generated result copy.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generate setup card extraction

- Extracted the roll setup form from `pages/generate.vue` into `components/encounters/EncounterGenerateSetupCard.vue`.
  - The component owns region/table/count/out-root/preview controls, selected-table metadata, and setup-specific styling with explicit `v-model` bindings and action emits.
  - The generate route now wires page state into setup/result cards while preserving URL/query behavior, browser-side preview rerolls, and request generation flow.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generate preview card extraction

- Extracted the browser-side rolled-encounters preview from `pages/generate.vue` into `components/encounters/EncounterRolledPreviewCard.vue`.
  - The component owns preview-list markup and styles while receiving a narrow `RolledEncounter[]` prop.
  - The generate route now focuses on encounter-generation state orchestration and composing setup, preview, error, and result cards.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generate intro/error cards

- Extracted generate-page intro copy and generation-error presentation into `components/encounters/EncounterGenerateIntroCard.vue` and `components/encounters/EncounterGenerateErrorCard.vue`.
  - The intro card receives only the table count; the error card receives only the normalized error message.
  - `pages/generate.vue` is now a compact route shell for metadata, URL-backed generation state, and card composition.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter table sidebar extraction

- Extracted the `/encounter-tables` sidebar, search input, grouped table list, and sidebar-specific styles into `components/encounters/EncounterTablesSidebar.vue`.
  - The component receives explicit filtered groups/counts/selection props, exposes `v-model:searchTerm`, and emits table selection without owning browser state.
  - The encounter-tables route now delegates sidebar presentation while preserving search filtering, active-table highlighting, and Generate-page navigation copy.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter table detail panel extraction

- Extracted the selected encounter-table detail pane into `components/encounters/EncounterTableDetailPanel.vue`.
  - The component owns table heading, roll-range rows, empty-state copy, Generate link, and detail-specific responsive styles with narrow selected-entry/row props.
  - `pages/encounter-tables.vue` is now a route shell that wires the encounter-table browser composable into sidebar and detail components.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation pick-step component

- Extracted the move-picking step from `components/MoveAutomationDialog.vue` into `components/move-automation/MoveAutomationPickStep.vue`.
  - The new component owns move-list search, move cards, explicit/manual badges, and pick-step styles with a narrow search model plus select-move emit.
  - The dialog now delegates pick-step presentation while keeping wizard state, move selection, resolution, and transaction assembly unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation review-step component

- Extracted the transaction-review step from `components/MoveAutomationDialog.vue` into `components/move-automation/MoveAutomationReviewStep.vue`.
  - The component owns HP/condition/combat-stage/map/log review sections, token-name lookup, manual-fallback warning, and review-specific styles.
  - The dialog now coordinates the wizard and delegates both pick and review presentation, while transaction construction and apply payloads remain unchanged.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation resolve-step component

- Extracted the move resolution step from `components/MoveAutomationDialog.vue` into `components/move-automation/MoveAutomationResolveStep.vue`.
  - The new component owns move summary, target selection, accuracy/damage rolls, condition/stage/HP/map-effect toggles, hazard-cell input, manual notes, and resolve-step styles through explicit props/models/emits.
  - The dialog now coordinates wizard state and transaction assembly while delegating all three wizard step presentations to focused components.
- Preserved target selection, roll actions, suggestion toggles, manual condition/stage inputs, map-effect GM gating, hazard-cell helpers, and transaction payload assembly.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation summary panel extraction

- Extracted the resolve-step move summary/sidebar into `components/move-automation/MoveAutomationSummaryPanel.vue`.
  - The summary panel now owns move badges, frequency/damage/range/crit stats, explicit-script/manual-fallback messaging, and summary-specific styles.
  - `MoveAutomationResolveStep.vue` now focuses on interactive resolution sections and delegates static move metadata display.
- Preserved move summary copy, badges, fallback warning, explicit script banner, and formula display.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation target resolution panel

- Extracted target selection plus accuracy/damage resolution UI into `components/move-automation/MoveAutomationTargetResolutionPanel.vue`.
  - The component owns target chips, roll-all controls, per-target accuracy/damage inputs, damage preview text, and target-resolution styles behind focused events.
  - `MoveAutomationResolveStep.vue` now delegates target mechanics while keeping suggestion/manual-effect sections together.
- Preserved target count behavior, self-target styling, roll buttons, hit/crit/apply-damage toggles, manual HP-loss override input, and damage multiplier preview.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation effects panel extraction

- Extracted condition, combat-stage, HP, map-effect, hazard-cell, manual-note, and script-note sections into `components/move-automation/MoveAutomationEffectsPanel.vue`.
  - The effects panel owns the remaining resolve-step suggestion/manual-effect presentation with explicit models and emits.
  - `MoveAutomationResolveStep.vue` is now a compact composition shell for summary, target resolution, and effect-resolution panels.
- Preserved suggestion toggles, manual condition picker state, combat-stage delta inputs, HP suggestion overrides, GM-gated map effects, hazard-cell text editing, and script-note display.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation status effects panel

- Extracted condition suggestions/manual condition pickers and combat-stage suggestions/manual deltas into `components/move-automation/MoveAutomationStatusEffectsPanel.vue`.
  - The status panel owns condition/stage-specific constants, inputs, picker layout, and responsive styles.
  - `MoveAutomationEffectsPanel.vue` now focuses on composing status effects with HP/map/manual-note effect sections.
- Preserved condition toggles, remove-label copy, condition picker bindings, stage suggestion toggles, stage delta inputs, and combat-stage label display.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation HP/map effects panel

- Extracted HP suggestions, field-effect suggestions, hazard suggestions, and hazard-cell entry UI into `components/move-automation/MoveAutomationHpMapEffectsPanel.vue`.
  - The new panel owns HP override inputs, GM-gated map-effect toggles, hazard cell textarea, Add user cell action, and associated styles.
  - `MoveAutomationEffectsPanel.vue` now composes status effects, HP/map effects, manual notes, and script notes without owning all effect-specific markup.
- Preserved HP suggestion amount overrides, field/hazard enablement rules, GM-only disabled state, hazard-cell text model, and Add user cell event flow.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation notes panel

- Extracted manual resolver notes and automation script notes into `components/move-automation/MoveAutomationNotesPanel.vue`.
  - The notes panel owns manual-note textarea, script-note list, warning styling, and note-specific section styles.
  - `MoveAutomationEffectsPanel.vue` is now a pure composition component that wires status, HP/map, and notes panels with explicit models/emits.
- Preserved manual note binding, script notes visibility, warning border styling, and note copy.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library breadcrumb nav

- Extracted the duplicated maps/sheets folder breadcrumb drop target into `components/library/FolderBreadcrumbNav.vue`.
  - The component owns breadcrumb/home icons, drop-target classes, current-folder ARIA state, and drag/drop event forwarding through explicit props/emits.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to use the shared breadcrumb component while preserving folder navigation and drag/drop behavior.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library folder tile

- Extracted duplicated folder-tile presentation and drag/drop forwarding from the maps/sheets library pages into `components/library/FolderTileButton.vue`.
  - The component owns folder icons, drop/drag visual states, count labels, and focused folder tile events.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to use the shared folder tile while preserving folder navigation, context menus, and drag/drop behavior.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library context menu

- Extracted the duplicated Move/Rename/Delete context-menu presentation from maps/sheets library pages into `components/library/LibraryContextMenu.vue`.
  - The shared component owns menu/dialog markup, Phosphor action icons, input focus/select behavior, move-destination controls, delete confirmation copy slots via suffix props, and scoped context-menu styles.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to keep only context state/actions while preserving move, rename, delete, Escape close, and busy/error behavior.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library intro panel

- Extracted the maps library intro/search/create controls into `components/library/MapLibraryIntroPanel.vue`.
  - The component owns map-library explanatory copy, count badge, GM/player hint copy, search model, create-map/create-folder buttons, and intro-card styles.
- Updated `pages/maps/index.vue` to compose the intro panel while keeping map loading, filtering, and create actions in the route shell.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library grid component

- Extracted the maps library folder/map grid and empty/loading states into `components/library/MapLibraryGrid.vue`.
  - The component owns map cards, folder tile composition, map visibility badges, map-grid styles, and focused drag/context event forwarding.
- Reduced `pages/maps/index.vue` to map library state orchestration, route navigation, realtime updates, and component composition.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library intro panel

- Extracted the sheets library intro/search/new-sheet/new-folder controls into `components/library/SheetLibraryIntroPanel.vue`.
  - The component owns sheet-library explanatory copy, filtered/total badge, GM/player hints, search model, new-sheet dropdown, create-folder action, backdrop handling, and intro/dropdown styles.
- Updated `pages/sheets/index.vue` to compose the intro panel while keeping sheet filtering, create actions, and menu state in the route shell.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library grid component

- Extracted the sheets library folder/sheet grid and empty states into `components/library/SheetLibraryGrid.vue`.
  - The component owns Pokémon/trainer sheet cards, type badges, shiny badge styles, folder tile composition, empty-state copy, and focused drag/context event forwarding.
- Reduced `pages/sheets/index.vue` to sheet library state orchestration, route navigation, creation actions, and component composition.
- Quality gates after this phase:
  - `npm test` — passes: 71 test files / 265 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library drag/drop composable

- Extracted maps/sheets library drag-and-drop bookkeeping into `composables/library/useLibraryDragDrop.ts`.
  - The composable owns active payload state, hover target state, transfer metadata setup, drop-target validation, hover updates, and validated payload capture before persistence.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to delegate generic drag/drop mechanics while keeping map/sheet/folder move persistence in the route shells.
- Added `tests/composables/library/useLibraryDragDrop.test.ts` covering allowed/blocked drag starts, hover gating, valid drop capture, and invalid drop cleanup.
- Quality gates after this phase:
  - `npm test` — passes: 72 test files / 270 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library context-menu state

- Extracted maps/sheets library right-click menu state into `composables/library/useLibraryContextMenu.ts`.
  - The composable owns target opening, mode transitions, input initialization, target-label derivation, move-destination derivation, and close behavior.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to inject target-specific labels, rename defaults, and move destinations while keeping persistence actions local to each route shell.
- Added `tests/composables/library/useLibraryContextMenu.test.ts` covering open gating, menu state shape, move/rename/delete transitions, and close behavior.
- Quality gates after this phase:
  - `npm test` — passes: 73 test files / 275 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: RefLink tooltip detail extraction

- Extracted reference-link target path and rich tooltip detail construction from `components/RefLink.vue` into `utils/refLinks.ts`.
  - The utility now owns ref-kind URL path mapping, descriptor/target pairing, present-value checks, and move/ability/capability/condition tooltip DTO construction.
- Updated `RefLink` to act as a smaller presentation/positioning adapter while preserving existing link paths, tooltip metadata, title fallback behavior, and badge rendering.
- Added `tests/utils/refLinks.test.ts` covering target paths, resolved/missing descriptors, move/ability/capability/condition tooltip payloads, unsupported tooltip kinds, and present-value semantics.
- Quality gates after this phase:
  - `npm test` — passes: 74 test files / 283 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: anchored tooltip positioning helper

- Extracted fixed-position tooltip placement math from `components/RefLink.vue` into `utils/anchoredTooltip.ts`.
  - The helper owns viewport clamping, top/bottom placement selection, custom gap/margin options, and the center-left coordinate contract used by `translateX(-50%)` tooltips.
- Updated `RefLink` to delegate only the geometry calculation while preserving tooltip show/hide lifecycle, listener cleanup, placement classes, and visual behavior.
- Added `tests/utils/anchoredTooltip.test.ts` covering default placement, horizontal clamping, above-anchor flipping, constrained vertical clamping, and custom spacing.
- Quality gates after this phase:
  - `npm test` — passes: 75 test files / 289 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: item index filtering helpers

- Extracted item-library count/search/filter derivations from `pages/items/index.vue` into `utils/reference/itemIndex.ts`.
  - The helper owns category counts, section counts, normalized item search haystacks, and combined category/section/search filtering.
- Updated the Items route to remain a UI shell over focused item-index derivations while preserving category chips, section filter behavior, search fields, and item card output.
- Added `tests/utils/reference/itemIndex.test.ts` covering search normalization, category/section count ordering, haystack matching, and combined filters.
- Quality gates after this phase:
  - `npm test` — passes: 76 test files / 294 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move index filtering helpers

- Extracted move-index type/search derivations from `pages/moves/index.vue` into `utils/reference/moveIndex.ts`.
  - The helper owns the `All` move-type option, sorted type option building, normalized move search haystacks, and combined type/search filtering.
- Added shared reference search primitives in `utils/reference/search.ts` and updated item-index helpers to use them without changing item page behavior.
- Updated the Moves route to consume focused helpers while preserving the type chip UI, search behavior, and move card output.
- Added `tests/utils/reference/moveIndex.test.ts` covering type option ordering, haystack matching, type/search filtering, and default All behavior.
- Quality gates after this phase:
  - `npm test` — passes: 77 test files / 298 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: feature index filtering helpers

- Extracted feature-index tag/search derivations from `pages/features/index.vue` into `utils/reference/featureIndex.ts`.
  - The helper owns feature tag counts, normalized search haystacks, combined tag/search filtering, and tag-toggle state transitions.
- Updated the Features route to consume focused helpers while preserving tag-chip ordering, search behavior, active tag toggling, and feature row output.
- Added `tests/utils/reference/featureIndex.test.ts` covering tag count ordering, feature search fields, tag/search filtering, and active-tag toggling.
- Quality gates after this phase:
  - `npm test` — passes: 78 test files / 302 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: ability index filtering helpers

- Extracted ability-index search matching from `pages/abilities/index.vue` into `utils/reference/abilityIndex.ts`.
  - The helper owns normalized matching across name, frequency, trigger, and effect fields while preserving source ordering and empty-query behavior.
- Updated the Abilities route to consume the focused helper and remain a UI shell for search state and rendering.
- Added `tests/utils/reference/abilityIndex.test.ts` covering haystack matching and filtered ordering.
- Quality gates after this phase:
  - `npm test` — passes: 79 test files / 304 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: edge index filtering helpers

- Extracted edge-index search matching from `pages/edges/index.vue` into `utils/reference/edgeIndex.ts`.
  - The helper owns normalized matching across name, prerequisites, and effect fields while preserving source ordering and empty-query behavior.
- Updated the Edges route to consume the focused helper and remain a UI shell for search state and rendering.
- Added `tests/utils/reference/edgeIndex.test.ts` covering haystack matching and filtered ordering.
- Quality gates after this phase:
  - `npm test` — passes: 80 test files / 306 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: condition index filtering helpers

- Extracted condition-index search and category grouping from `pages/conditions/index.vue` into `utils/reference/conditionIndex.ts`.
  - The helper owns normalized matching across name, alias, category, source, and effect fields plus filtered category regrouping.
- Updated the Conditions route to consume focused helpers while preserving condition group order and empty-state behavior.
- Added `tests/utils/reference/conditionIndex.test.ts` covering haystack matching, filtered ordering, and category regrouping.
- Quality gates after this phase:
  - `npm test` — passes: 81 test files / 309 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: rule index filtering helpers

- Extracted rule-index category counts, search matching, category filtering, grouping, and category toggling from `pages/rules/index.vue` into `utils/reference/ruleIndex.ts`.
  - The helper preserves category-count ordering, filtered rule order, and alphabetical group presentation.
- Updated the Rules route to consume focused helpers while keeping the existing category chip/search UI behavior.
- Added `tests/utils/reference/ruleIndex.test.ts` covering category counts, haystack matching, combined filters, grouping, and toggle behavior.
- Quality gates after this phase:
  - `npm test` — passes: 82 test files / 314 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: item detail related-item helper

- Extracted item detail related-item selection from `pages/items/[slug].vue` into `utils/reference/itemDetails.ts`.
  - The helper owns primary-category matching, current-item exclusion, and result limiting while preserving related item order.
- Updated the Item detail route to consume the focused helper and keep route/page state separate from related-item derivation.
- Added `tests/utils/reference/itemDetails.test.ts` covering primary-category matching, current-item exclusion, limits, and empty inputs.
- Quality gates after this phase:
  - `npm test` — passes: 83 test files / 318 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: feature detail sibling helper

- Extracted trainer-class sibling feature derivation from `pages/features/[slug].vue` into `utils/reference/featureDetails.ts`.
  - The helper owns class-name matching, current-feature exclusion, and sibling limiting while preserving source ordering.
- Updated the Feature detail route to consume the focused helper and keep route state separate from sibling derivation.
- Added `tests/utils/reference/featureDetails.test.ts` covering class siblings, current-name exclusion, limits, and empty inputs.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference not-found card

- Extracted duplicated reference-detail missing-entry markup into `components/reference/ReferenceNotFoundCard.vue`.
  - The component owns the standard panel-card title, slug display, and return link while each route provides its own copy and destination.
- Updated ability, move, edge, condition, rule, item, and feature detail routes to use the shared card while preserving existing not-found text and back links.
- Left the currently user-modified capabilities detail page untouched to avoid mixing unrelated in-progress changes.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference filter chips

- Extracted duplicated reference-index category/tag chip presentation into `components/reference/ReferenceFilterChips.vue`.
- Updated item, rule, and feature index routes to pass focused chip DTOs while preserving active filter toggles, counts, ARIA pressed state, and existing styling.
- Removed duplicated filter-chip CSS from the route pages so chip presentation lives in one component.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference index header

- Extracted duplicated PTU reference index app-navigation, heading, count badge, and panel shell into `components/reference/ReferenceIndexHeader.vue`.
- Updated ability, edge, move, item, feature, rule, and condition index routes to compose their existing copy/filter controls inside the shared header shell.
- Preserved existing index route URLs, counts, search/filter inputs, and reference-page styling while reducing route-local presentation boilerplate.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference detail shell

- Extracted duplicated reference-detail app-navigation, back-link, and main-content shell into `components/reference/ReferenceDetailShell.vue`.
- Updated ability, move, edge, rule, condition, item, and feature detail routes to use the shared shell while preserving their article content and not-found cards.
- Left the currently user-modified capabilities detail/index pages untouched to avoid mixing unrelated in-progress changes.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference field block

- Extracted repeated reference-detail field section markup into `components/reference/ReferenceFieldBlock.vue`.
- Updated ability, move, edge, rule, condition, feature, and item detail pages to use the shared field block while preserving all text, list, sibling, and related-item content.
- Kept page-specific detail styles local where they are still specific to item/feature related lists and tag displays.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference detail heading

- Extracted repeated reference-detail heading/title/pill markup into `components/reference/ReferenceDetailHeading.vue`.
- Updated ability, move, edge, rule, condition, and feature detail pages to use the shared heading component while preserving badge/type/condition pill output.
- Kept the item detail heading route-local because it has item-sprite-specific layout that differs from the standard detail heading.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference type filter

- Extracted move-index type-filter radiogroup presentation into `components/reference/ReferenceTypeFilter.vue`.
- Updated the Moves route to bind type state through a focused `v-model:active-type` interface while preserving All/type badge buttons, active styling, and ARIA pressed semantics.
- Removed move-index-local type-filter CSS now owned by the shared reference filter component.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference search field

- Extracted repeated reference-index search label/input markup into `components/reference/ReferenceSearchField.vue`.
- Updated ability, edge, condition, rule, feature, move, and item index pages to bind search state through the shared component while preserving trimmed model updates, labels, placeholders, and global reference input styling.
- Kept capabilities pages untouched because they still contain user-modified work outside this refactor cycle.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference select field

- Extracted the reference-index select/input presentation used by the Items section filter into `components/reference/ReferenceSelectField.vue`.
- Updated the Items index route to build explicit section-option DTOs and delegate select markup/focus styling to the shared field component.
- Preserved item category/search/section filtering behavior and section count labels.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: item index list component

- Extracted the Items index result-list/card markup into `components/reference/ItemIndexList.vue`.
- Reduced `pages/items/index.vue` to filter state, option derivation, and composition of shared reference controls plus the focused item list.
- Preserved item links, sprites, category/cost/section badge truncation, effect previews, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: item detail article component

- Extracted the item detail page article, item sprite heading, stats strip, effect/notes blocks, and related-item list into `components/reference/ItemDetailArticle.vue`.
- Reduced `pages/items/[slug].vue` to route lookup, metadata, related-item derivation, shared shell, and not-found handling.
- Preserved item detail heading layout, sprite alt text, costs/sections display, effect/notes rendering, related item links, and missing-item copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: feature detail article component

- Extracted the feature detail article, tag heading, class note, field blocks, and sibling-feature list into `components/reference/FeatureDetailArticle.vue`.
- Reduced `pages/features/[slug].vue` to route lookup, metadata, sibling derivation, shared shell, and not-found handling.
- Preserved feature tag pills, class links, all detail fields, sibling feature links/tags, and missing-feature copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: rule grouped list component

- Extracted the Rules index grouped result list into `components/reference/RuleIndexGroupedList.vue`.
- Reduced `pages/rules/index.vue` to search/category state, category chip derivation, grouping, and reference shell composition.
- Preserved category grouping, rule links, source badges, text previews, heading typography, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: condition grouped list component

- Extracted the Conditions index grouped result list into `components/reference/ConditionIndexGroupedList.vue`.
- Reduced `pages/conditions/index.vue` to search state, filtering/grouping derivation, and reference shell composition.
- Preserved condition category headings, condition tag badges, source badges, effect previews, route links, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move index list component

- Extracted the Moves index result-list markup into `components/reference/MoveIndexList.vue`.
- Reduced `pages/moves/index.vue` to search/type filter state, type option derivation, reference shell controls, and focused list composition.
- Preserved move links, type badges, damage-class badges, DB/AC/range pills, effect previews, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: ability index list component

- Extracted the Abilities index result-list markup into `components/reference/AbilityIndexList.vue`.
- Reduced `pages/abilities/index.vue` to search state, ability filtering, reference header composition, and the focused list component.
- Preserved ability links, frequency badges, trigger/effect previews, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: edge index list component

- Extracted the Edges index result-list markup into `components/reference/EdgeIndexList.vue`.
- Reduced `pages/edges/index.vue` to search state, edge filtering, reference header composition, and the focused list component.
- Preserved edge links, prerequisite/effect previews, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: feature index list component

- Extracted the Features index result-list markup and tag-badge styles into `components/reference/FeatureIndexList.vue`.
- Reduced `pages/features/index.vue` to tag/search state, filter derivation, reference controls, and the focused list component.
- Preserved feature links, tag badges, frequency/prerequisite/effect previews, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: ability detail article component

- Extracted the ability detail article markup into `components/reference/AbilityDetailArticle.vue`.
- Reduced `pages/abilities/[slug].vue` to route lookup, metadata, shared detail shell, and not-found handling.
- Preserved ability detail heading, frequency badge, trigger/effect field blocks, and missing-ability copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move detail article component

- Extracted the move detail article, heading badges, stat strip, and effect block into `components/reference/MoveDetailArticle.vue`.
- Reduced `pages/moves/[slug].vue` to route lookup, metadata, shared detail shell, and not-found handling.
- Preserved move type/damage-class/frequency badges, DB/AC/range stats, effect text, and missing-move copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: edge detail article component

- Extracted the edge detail article markup into `components/reference/EdgeDetailArticle.vue`.
- Reduced `pages/edges/[slug].vue` to route lookup, metadata, shared detail shell, and not-found handling.
- Preserved edge detail heading, prerequisite/effect field blocks, and missing-edge copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: rule detail article component

- Extracted the rule detail article markup into `components/reference/RuleDetailArticle.vue`.
- Reduced `pages/rules/[slug].vue` to route lookup, metadata, shared detail shell, and not-found handling.
- Preserved rule category/source badges, rule text field block, and missing-rule copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: condition detail article component

- Extracted the condition detail article markup into `components/reference/ConditionDetailArticle.vue`.
- Reduced `pages/conditions/[slug].vue` to route lookup, metadata, shared detail shell, and not-found handling.
- Preserved condition badges, aliases/effect field blocks, and missing-condition copy.
- Quality gates after this phase:
  - `npm test` — passes: 84 test files / 322 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: login redirect helper extraction

- Extracted login redirect validation and player-blocked route fallback logic from `pages/login.vue` into `utils/loginRedirect.ts`.
- Updated the login route to delegate redirect target resolution while preserving `/maps` fallback behavior, unsafe external redirect rejection, and player restrictions for generate/encounter-table routes.
- Added `tests/utils/loginRedirect.test.ts` for safe internal redirect checks, blocked player paths, unsafe fallback behavior, and GM-vs-player redirects.
- Quality gates after this phase:
  - `npm test` — passes: 85 test files / 326 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: reference detail title helper

- Extracted repeated reference-detail title formatting into `utils/reference/pageTitles.ts`.
- Updated ability, move, edge, rule, condition, item, and feature detail routes to use the shared formatter while preserving selected-entry and not-found page titles.
- Added `tests/utils/reference/pageTitles.test.ts` for found and missing reference-detail titles.
- Quality gates after this phase:
  - `npm test` — passes: 86 test files / 328 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: reference index title helper

- Extended `utils/reference/pageTitles.ts` with shared reference-index title formatting.
- Updated ability, move, edge, rule, condition, item, and feature index routes to use the shared formatter while preserving existing document titles.
- Expanded `tests/utils/reference/pageTitles.test.ts` to cover index titles.
- Quality gates after this phase:
  - `npm test` — passes: 86 test files / 329 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: route slug param helper

- Added `utils/routeParams.ts` to centralize route-param-to-string normalization for slug routes.
- Updated ability, move, edge, rule, condition, item, and feature detail routes to use the shared slug helper while preserving previous string coercion behavior.
- Added `tests/utils/routeParams.test.ts` covering missing values and existing route-param coercion semantics.
- Quality gates after this phase:
  - `npm test` — passes: 87 test files / 331 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared reference empty state component

- Extracted repeated reference-list empty-state markup into `components/reference/ReferenceEmptyState.vue`.
- Updated ability, move, edge, rule, condition, item, and feature index list components to use the shared empty-state component while preserving copy and styling classes.
- Left the currently user-modified capabilities index page untouched.
- Quality gates after this phase:
  - `npm test` — passes: 87 test files / 331 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: legacy grid redirect helpers

- Extracted legacy `/grids` redirect path construction into `utils/legacyGridRoutes.ts`.
- Updated `/grids` and `/grids/[slug]` redirect pages to use the focused helper while preserving query passthrough and previous slug coercion behavior.
- Added `tests/utils/legacyGridRoutes.test.ts` covering index redirects and slug detail redirect paths.
- Quality gates after this phase:
  - `npm test` — passes: 88 test files / 333 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared client error-message helper

- Added `utils/errorMessages.ts` to normalize Nuxt `$fetch`, runtime `Error`, primitive string, and nullish error values into stable user-facing messages.
- Updated editable map/sheet autosave and maps/sheets library pages to use the shared helper instead of repeating `statusMessage`/`data.statusMessage`/`message` fallback chains.
- Added `tests/utils/errorMessages.test.ts` covering HTTP status messages, Nuxt fetch data messages, `Error.message`, primitive strings, and nullish fallbacks.
- Quality gates after this phase:
  - `npm test` — passes: 89 test files / 337 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared sheet route helpers

- Added `utils/sheetRoutes.ts` for encoded Pokémon/trainer sheet editor paths and user-facing sheet-kind labels.
- Updated sheet creation redirects, sheet library card links, and map token sheet links to use the shared route helper instead of duplicating `/sheets` vs `/sheets/trainers` branching.
- Reused the existing `sheetLibraryKey` helper for sheet library override/deletion keys while keeping route generation in the new focused module.
- Added `tests/utils/sheetRoutes.test.ts` covering encoded editor paths and sheet-kind labels.
- Quality gates after this phase:
  - `npm test` — passes: 90 test files / 339 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet browser helper extraction

- Extracted `SheetBrowser` item construction, folder tile derivation, subtree search filtering, and selection payload creation into `utils/sheetBrowser.ts`.
- Updated `components/SheetBrowser.vue` to focus on panel state and presentation while reusing shared folder breadcrumb helpers and the new browser-specific utility functions.
- Added `tests/utils/sheetBrowser.test.ts` covering Pokémon/trainer item DTOs, folder sets/tiles, direct-vs-search filtering, and selection payloads.
- Quality gates after this phase:
  - `npm test` — passes: 91 test files / 343 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet browser breadcrumb component

- Extracted the `SheetBrowser` folder breadcrumb markup and styles into `components/sheets/SheetBrowserBreadcrumbs.vue` with explicit breadcrumb/current-path props and a focused navigate emit.
- Reduced `components/SheetBrowser.vue` so it composes the breadcrumb component instead of owning folder-navigation presentation details inline.
- Preserved sheet browser folder navigation, current-folder ARIA state, home icon display, and compact breadcrumb styling.
- Quality gates after this phase:
  - `npm test` — passes: 91 test files / 343 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet browser list component

- Extracted the `SheetBrowser` folder/sheet result list into `components/sheets/SheetBrowserList.vue` with explicit folder/item props and focused open/select emits.
- Moved folder row, sheet row, sprite fallback, and empty-state styles into the list component so the parent browser remains a small state/composition shell.
- Preserved browser row ordering, folder counts, Pokémon/trainer styling, sprite display, and empty-folder copy.
- Quality gates after this phase:
  - `npm test` — passes: 91 test files / 343 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: reference tooltip component extraction

- Extracted rich reference-link tooltip markup and scoped styles from `components/RefLink.vue` into `components/reference/ReferenceTooltip.vue`.
- Kept `RefLink` focused on reference target lookup, tooltip positioning lifecycle, and link fallback behavior while the new component owns tooltip presentation for move/ability/capability/condition metadata.
- Preserved Teleport rendering, anchored tooltip positioning, type/damage-class badges, section copy, ready/placement classes, and accessibility role/id wiring.
- Quality gates after this phase:
  - `npm test` — passes: 91 test files / 343 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: anchored tooltip composable extraction

- Extracted shared anchored-tooltip visibility, ready state, resize/scroll listener, animation-frame scheduling, and position update lifecycle into `composables/reference/useAnchoredTooltip.ts`.
- Updated `components/RefLink.vue` to consume the composable so the component now only wires reference lookup, label/title state, link events, and `ReferenceTooltip` presentation.
- Preserved tooltip show/hide triggers, Escape handling, listener cleanup, viewport clamping, placement classes, and Teleport root measurement behavior.
- Quality gates after this phase:
  - `npm test` — passes: 91 test files / 343 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: editable cell helper extraction

- Extracted `EditableCell` value emptiness, display formatting, draft initialization, select-option normalization, and numeric draft parsing/clamping into `utils/editableCell.ts`.
- Updated `components/EditableCell.vue` to focus on edit-session state, DOM focus/keyboard handling, and event emission while pure value behavior lives in a tested utility.
- Added `tests/utils/editableCell.test.ts` covering empty detection, display formatting, draft creation, option normalization, numeric parsing/clamping, invalid number fallback, and non-number draft preservation.
- Quality gates after this phase:
  - `npm test` — passes: 92 test files / 348 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: app navigation helper extraction

- Extracted primary/reference navigation item definitions, GM-only filtering, and active-route matching into `utils/appNavigation.ts`.
- Updated `components/AppNavigation.vue` to render navigation from the shared item configuration instead of duplicating one `NuxtLink` per route inline.
- Added `tests/utils/appNavigation.test.ts` covering player-vs-GM visibility, `/maps` legacy `/grids` active-state behavior, exact home matching, and prefix matching for detail routes.
- Quality gates after this phase:
  - `npm test` — passes: 93 test files / 351 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: save indicator helper extraction

- Extracted save-status label and error-title normalization into `utils/saveIndicator.ts`.
- Updated `components/SaveIndicator.vue` to delegate status copy/title rules to the focused helper while keeping pill presentation and status styling local.
- Added `tests/utils/saveIndicator.test.ts` covering idle/saving/saved/error labels and nullable title normalization.
- Quality gates after this phase:
  - `npm test` — passes: 94 test files / 353 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: capability index filtering helper

- Extracted capability-index search haystack construction and filtering into `utils/reference/capabilityIndex.ts`.
- Updated the Capabilities index route to use shared reference header/search/empty-state components while preserving capability links, art, search behavior, and explanatory copy.
- Added `tests/utils/reference/capabilityIndex.test.ts` covering name/effect haystacks, normalized query matching, and stable filtered ordering.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 356 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: capability index list component

- Extracted the Capabilities index result-list/card markup into `components/reference/CapabilityIndexList.vue`.
- Reduced `pages/capabilities/index.vue` to search/filter state plus shared reference header/list composition.
- Preserved capability art, routes, effect previews, responsive row styling, and empty-state copy.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 356 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: capability detail article component

- Extracted the Capability detail article into `components/reference/CapabilityDetailArticle.vue` with focused art, heading, and effect rendering.
- Updated `pages/capabilities/[slug].vue` to use the shared reference detail shell, not-found card, route slug helper, and reference title formatter.
- Preserved capability detail route URLs, art layout, effect copy, back links, and missing-capability copy.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 356 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library visible-state helpers

- Extended `utils/mapLibrary.ts` with focused map-library search matching, folder-set derivation, and visible-map filtering helpers.
- Updated `pages/maps/index.vue` to delegate map folder collection and search/current-folder filtering while keeping fetch, realtime, drag/drop, and persistence orchestration in the route shell.
- Expanded `tests/utils/mapLibrary.test.ts` to cover map summary search matching, folder-set construction, and visible-map filtering/sorting behavior.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 359 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library visible-state helpers

- Extended `utils/sheetLibrary.ts` with visible sheet filtering and filtered-count helpers that own current-folder/subtree search behavior and sort-key ordering.
- Updated `pages/sheets/index.vue` to delegate visible sheet derivation and filtered count calculation while keeping sheet creation, drag/drop, context actions, and local overrides in the route shell.
- Expanded `tests/utils/sheetLibrary.test.ts` to cover visible sheet filtering/sorting and full-collection filtered counts.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 361 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library folder navigation composable

- Extracted repeated maps/sheets library folder-route state into `composables/library/useLibraryFolderNavigation.ts`.
- Updated map and sheet library routes to use the shared composable for `?folder=` normalization, breadcrumb derivation, and folder navigation while preserving route paths and formatted map-folder labels.
- Kept route-specific create/navigation side effects in the route shells.
- Quality gates after this phase:
  - `npm test` — passes: 95 test files / 361 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared DOM event value helpers

- Added `utils/domEvents.ts` to centralize text, trimmed text, checkbox, loose number, and finite number extraction from DOM events.
- Updated map details, terrain/hazard, field-effect, move-automation status/HP-map, and reference search controls to use the shared event helpers instead of repeated inline target casts.
- Added `tests/utils/domEvents.test.ts` covering text extraction, checkbox fallback behavior, loose number parsing, and finite-number fallback behavior.
- Quality gates after this phase:
  - `npm test` — passes: 96 test files / 365 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: DOM event helper adoption cleanup

- Reused `utils/domEvents.ts` across the remaining library/search/modal inputs and map-editor composables that were still casting DOM event targets inline.
- Updated `EditableCell` select/input handling, library intro/context-menu fields, map admin ground-level input, trainer portrait search, initiative inputs, field-effect duration parsing, and terrain color input to use shared event value extraction.
- Verified no app component/composable outside `utils/domEvents.ts` still performs direct `HTMLInputElement`/`HTMLSelectElement` target casts for simple value extraction.
- Quality gates after this phase:
  - `npm test` — passes: 96 test files / 365 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: keyboard shortcut helpers and lifecycle cleanup

- Added shared keyboard shortcut predicates for Escape and Ctrl+Shift+letter combinations.
- Added `useWindowKeydown` to centralize mounted/unmounted window key listener registration.
- Replaced ad hoc library-page Escape listeners with the lifecycle-safe composable and reused shortcut predicates in the map admin shortcut handler.
- Quality gates after this phase:
  - `npm test` — passes: 97 test files / 367 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: folder path utility consolidation

- Added reusable folder path helpers for leaf extraction and parent/leaf joining, then reused the existing descendant/prefix helpers in folder move validation.
- Updated map and sheet library pages to use folder helpers for create, rename, delete, and current-folder follow-up navigation instead of repeating string slicing/prefix checks inline.
- Expanded folder helper coverage for leaf names, joins, and descendant checks.
- Quality gates after this phase:
  - `npm test` — passes: 97 test files / 367 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared keydown lifecycle adoption

- Reused `useWindowKeydown` for the map admin shortcut and `IsometricGrid` Escape handling instead of manually registering/removing window keydown listeners in component lifecycle hooks.
- Preserved Ctrl+Shift+A admin panel behavior, Escape handling, and renderer teardown order while keeping keyboard listener ownership in the shared lifecycle composable.
- Quality gates after this phase:
  - `npm test` — passes: 97 test files / 367 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared map route helpers

- Added `utils/mapRoutes.ts` for the canonical map library path and encoded map editor route construction.
- Updated map route redirects, map library card links, map page rename redirects, app navigation, login fallback, and map sidebar/not-found links to use the shared helpers instead of repeating `/maps` string construction.
- Added `tests/utils/mapRoutes.test.ts` covering the canonical library path and encoded editor paths.
- Quality gates after this phase:
  - `npm test` — passes: 98 test files / 369 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: layer visibility controls component

- Extracted the map terrain/hazard panel's layer visibility controls into `components/map/LayerVisibilityControls.vue` with focused props and `set-layer-visibility` emits.
- Added `utils/mapLayerVisibility.ts` to keep layer-label formatting out of templates and covered it with unit tests.
- Reduced `TerrainHazardsPanel` by delegating layer checkbox presentation while preserving layer visibility behavior and styling.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: terrain builder controls component

- Extracted terrain build tool, material swatches, custom-color controls, build hint, and terrain bulk actions from `TerrainHazardsPanel` into `components/map/TerrainBuilderControls.vue`.
- Kept terrain-specific presentation and emits in the focused component while the parent panel now composes terrain controls, layer controls, and hazard controls separately.
- Preserved build tool selection, material/custom color behavior, fill-ground, clear-all-terrain, and layer visibility wiring.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: hazard builder controls component

- Extracted hazard tool selection, hazard palette, hazard editing hint, and clear-hazards action from `TerrainHazardsPanel` into `components/map/HazardBuilderControls.vue`.
- Removed now-dead hazard/tool/input styles from the parent panel so it primarily owns panel chrome and mode composition.
- Preserved hazard place/erase tool behavior, active hazard selection, Toxic Spikes hint copy, and clear-all-hazards event wiring.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map editor mode toggle component

- Extracted the Terrain/Hazards panel's Play/Build/Hazards mode selector into `components/map/MapEditorModeToggle.vue` with a focused `set-mode` emit.
- Removed mode-button styles from `TerrainHazardsPanel`, leaving it as a panel chrome/composition component over the mode toggle plus terrain, layer, and hazard controls.
- Preserved active mode highlighting, ARIA pressed state, and editor mode event wiring.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared collapsible map panel heading

- Extracted duplicated collapsible sidebar panel heading markup/styles into `components/map/CollapsiblePanelHeading.vue`.
- Updated terrain/hazard and field-effects panels to use the shared heading component with explicit title, badge, collapsed state, and controls-id props.
- Preserved heading copy, badges, chevrons, ARIA expanded/controls wiring, and collapse event behavior while removing duplicated heading CSS from both panels.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map details heading reuse

- Reused the shared `CollapsiblePanelHeading` in `components/map/MapDetailsPanel.vue` instead of keeping a duplicate collapsible sidebar heading implementation.
- Removed map-details-local heading/badge styles while preserving the map title, dimension badge, collapse control, and `aria-controls` behavior.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: field-effect swatch grid component

- Extracted repeated weather/terrain/room swatch-button markup and styles from `FieldEffectsPanel` into `components/map/FieldEffectSwatchGrid.vue`.
- Kept `FieldEffectsPanel` responsible for typed map-effect event routing while the new component owns generic swatch presentation, active styling, tooltips, and ARIA group semantics.
- Preserved weather set behavior, terrain/room toggle behavior, disabled map-edit gating, and effect-color styling.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: field-effect chip list component

- Extracted active field-effect chip rendering, duration inputs, remove buttons, and empty-state copy into `components/map/FieldEffectChipList.vue`.
- Kept weather/terrain/room event typing in `FieldEffectsPanel` through narrow adapter functions while the new component owns generic chip presentation.
- Preserved duration editing, room "starts next round" text, remove labels, disabled-map-edit behavior, and active-effect empty messages.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: field-effect section component

- Extracted the repeated field-effect group shell into `components/map/FieldEffectSection.vue`, composing the shared swatch grid and chip list behind explicit section props/events.
- Reduced `FieldEffectsPanel` to typed weather/terrain/room adapters plus top-level panel actions, with weather coexist controls kept as a section slot.
- Preserved section headings/notes, Weather clear behavior, swatch selection, duration editing, remove actions, and section spacing.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative controls component

- Extracted initiative heading, round input, turn controls, and utility buttons into `components/map/InitiativeControls.vue`.
- Kept `InitiativeTracker` responsible for list rendering while the new controls component owns initiative action presentation and responsive control styling.
- Preserved round edits, previous/next/start behavior, speed-fill/reset actions, disabled-state rules, and character-count badge copy.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative row component

- Extracted initiative row rendering into `components/map/InitiativeRowItem.vue`, including sprite display, HP bar, conditions, initiative input, and Use Speed action styling.
- Reduced `InitiativeTracker` to a panel shell that composes controls and rows while forwarding the same focused events.
- Preserved active/selected/fainted row styling, token focus action, active-turn selection, initiative edits, speed-fill per row, and responsive row layout.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative list component

- Extracted initiative list/empty-state composition into `components/map/InitiativeList.vue`.
- `InitiativeTracker` is now a compact panel shell that composes initiative controls and the focused list while preserving all forwarded initiative events.
- Preserved sorted row rendering, empty-state copy, list spacing, and row action payloads.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative token sprite component

- Extracted initiative row sprite/sprite-sheet/fallback rendering into `components/map/InitiativeTokenSprite.vue`.
- Reduced `components/map/InitiativeRowItem.vue` so it no longer owns sprite presentation details while preserving turn-button behavior and sprite frame styling.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative vitals component

- Extracted initiative row HP bar, HP tier styling, and condition tag presentation into `components/map/InitiativeVitals.vue`.
- Reduced `components/map/InitiativeRowItem.vue` so it delegates token vitals to a focused component while preserving HP percentages, fainted styling, and condition badges.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: initiative score editor component

- Extracted initiative value editing and per-row Use Speed action into `components/map/InitiativeScoreEditor.vue`.
- Reduced `components/map/InitiativeRowItem.vue` to row state and layout while preserving initiative input events, disabled-state behavior, and speed-fill action payloads.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map sidebar toggle component

- Extracted the map sidebar collapse/expand button and collapsed-state styles into `components/map/MapSidebarToggle.vue`.
- Reduced `components/map/MapLeftSidebar.vue` so it delegates sidebar toggle presentation while preserving ARIA state, labels, and collapsed styling.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map sidebar header component

- Extracted the map sidebar navigation, return link, and save indicator into `components/map/MapSidebarHeader.vue`.
- Reduced `components/map/MapLeftSidebar.vue` so header chrome is isolated from map editor panel wiring while preserving the All maps link and save-status display.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: field-effect weather options component

- Extracted Weather coexist/Climate Control option UI from `FieldEffectsPanel` into `components/map/FieldEffectWeatherOptions.vue`.
- Kept `FieldEffectsPanel` focused on typed weather/terrain/room section wiring while preserving coexist toggle gating, checked-state parsing, and copy.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: field-effect bulk actions component

- Extracted field-effect duration advance/clear controls into `components/map/FieldEffectBulkActions.vue`.
- Reduced `FieldEffectsPanel` to field-effect section composition and typed event adapters while preserving GM-only action visibility, disabled states, and clear/advance emits.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: collapsible map panel shell

- Extracted shared collapsible map panel chrome into `components/map/CollapsiblePanelCard.vue`.
- Updated map details, terrain/hazards, and field-effects panels to compose the shared card while preserving heading badges, collapse behavior, panel spacing, and existing emits.
- Removed duplicated panel-card and collapsible-body styles from those focused panel components.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map details control components

- Extracted the map player-visibility toggle into `components/map/MapVisibilityToggle.vue`.
- Extracted the map dimension inputs into `components/map/MapDimensionControls.vue` with the existing DOM-event number parsing behavior.
- Reduced `MapDetailsPanel` to a shell over the shared collapsible card plus focused visibility/dimension controls while preserving GM/player copy and update emits.
- Quality gates after this phase:
  - `npm test` — passes: 99 test files / 370 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map panel badge helpers

- Added `utils/mapPanelBadges.ts` for reusable map dimension, terrain/hazard count, field-effect count, and pluralized badge formatting.
- Updated map details, terrain/hazards, and field-effects panels to use the shared badge helpers instead of inline template string/pluralization logic.
- Added `tests/utils/mapPanelBadges.test.ts` to cover dimension badges, singular/plural count labels, terrain/hazard badges, and field-effect badges.
- Quality gates after this phase:
  - `npm test` — passes: 100 test files / 374 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map scene status component

- Extracted map loading, not-found, error, and ClientOnly fallback presentation into `components/map/MapSceneStatus.vue`.
- Reduced `MapScenePanel` so scene state copy/links/styles are isolated from renderer and move-automation overlay wiring.
- Preserved loading text, missing-map back link, error fallback copy, and map library route generation.
- Quality gates after this phase:
  - `npm test` — passes: 100 test files / 374 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map scene renderer adapter

- Extracted `IsometricGrid` prop/event wiring from `MapScenePanel` into `components/map/MapSceneRenderer.vue`.
- Kept renderer focus exposure through a narrow `focusPokemon(id)` adapter so initiative focusing remains unchanged while the scene panel becomes a higher-level composition shell.
- Preserved all existing renderer props, token/map interaction emits, and public `MapScenePanel` focus API.
- Quality gates after this phase:
  - `npm test` — passes: 100 test files / 374 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map move automation overlay component

- Extracted move-automation dialog presentation/wiring from `MapScenePanel` into `components/map/MapMoveAutomationOverlay.vue`.
- The overlay now owns the `MoveAutomationDialog` null-user guard and forwards close/apply events through a narrow component contract.
- Further reduced `MapScenePanel` to compose scene status, renderer, and overlay concerns without directly importing the automation dialog.
- Quality gates after this phase:
  - `npm test` — passes: 100 test files / 374 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared sidebar collapse toggle

- Extracted shared sidebar collapse/expand button presentation into `components/map/SidebarCollapseToggle.vue`.
- Updated the left map sidebar toggle and right initiative sidebar to use the shared toggle while preserving opposite arrow directions, ARIA controls/labels, titles, collapsed sizing, and alignment.
- Removed duplicated initiative-toggle styles and kept sidebar-specific layout styles in their own shell components.
- Quality gates after this phase:
  - `npm test` — passes: 100 test files / 374 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared map ground-level helpers

- Added `utils/mapGroundLevel.ts` to centralize map ground-level clamping, maximum layer calculation, and map-specific Y-range derivation.
- Updated the map editor page and isometric scene-state helper to reuse the shared ground-level rules instead of keeping separate clamp implementations.
- Added `tests/utils/mapGroundLevel.test.ts` covering height bounds, finite integer clamping, and map-specific Y-range output.
- Quality gates after this phase:
  - `npm test` — passes: 101 test files / 377 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map dimension reconciliation helper

- Extracted map dimension normalization, ground-level clamping, terrain/hazard trimming, and token placement reconciliation into `utils/mapDimensionReconciliation.ts`.
- Updated the map editor route to call the focused reconciliation helper from its dimensions watcher instead of owning grid/storage cleanup details inline.
- Added `tests/utils/mapDimensionReconciliation.test.ts` covering dimension normalization, ground-level bounds, terrain/hazard filtering, token fallback/removal, selected-token cleanup, and absent ground metadata.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map editor layout shell component

- Extracted the map editor grid layout, collapsed-column classes, and responsive layout CSS into `components/map/MapEditorLayout.vue`.
- Updated `pages/maps/[slug].vue` to compose left sidebar, scene, initiative sidebar, and admin overlay through named layout slots while preserving all existing editor state wiring.
- Removed route-local layout styles so the map route remains focused on editor orchestration instead of shell presentation.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared build tool toggle component

- Extracted the duplicated terrain/hazard pencil-vs-eraser control into `components/map/BuildToolToggle.vue` with configurable labels and a narrow `set-tool` emit.
- Updated terrain and hazard builder controls to consume the shared toggle while preserving active styling, ARIA pressed state, labels, and tool-change events.
- Removed duplicated tool-row/button CSS from the terrain and hazard controls.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: terrain material grid component

- Extracted terrain material swatch rendering into `components/map/TerrainMaterialGrid.vue` with explicit active-material, custom-color, material-list props and a focused select emit.
- Reduced `TerrainBuilderControls` so it composes the shared build-tool toggle and focused material grid while preserving swatch colors, active state, labels, and material-selection behavior.
- Moved material-grid CSS out of the terrain controls component.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: terrain color picker component

- Extracted terrain custom-color input/reset presentation into `components/map/TerrainColorPicker.vue` with explicit color-value and custom-color state props.
- Updated `TerrainBuilderControls` to delegate color picking/reset events while preserving the existing color input value, reset visibility, and event payloads.
- Moved color-picker and reset-button CSS out of the terrain controls component.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: hazard palette grid component

- Extracted hazard swatch-grid rendering into `components/map/HazardPaletteGrid.vue` with explicit active-kind/hazard-list props and a focused selection emit.
- Reduced `HazardBuilderControls` so it composes the shared build-tool toggle and focused hazard palette while preserving hazard colors, labels, tooltips, ARIA pressed state, and selection behavior.
- Moved hazard swatch/grid CSS out of the hazard controls component.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared terrain/hazard bulk action controls

- Extracted duplicated terrain/hazard bulk-action row and button presentation into `components/map/BuilderBulkActionRow.vue` and `components/map/BuilderBulkButton.vue`.
- Updated terrain and hazard builder controls to compose the shared bulk-action primitives while preserving fill-ground, clear-terrain, and clear-hazards disabled-state behavior and styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared builder hint text

- Extracted the repeated terrain/hazard builder instruction paragraph into `components/map/BuilderHintText.vue`.
- Updated terrain and hazard builder controls to consume the shared hint component while preserving the existing click/erase guidance copy.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation step indicator component

- Extracted the move-automation wizard step indicator from `components/MoveAutomationDialog.vue` into `components/move-automation/MoveAutomationStepIndicator.vue`.
- Kept the dialog responsible for wizard state while the focused component owns step markup, active styling, and accessibility label.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation footer component

- Extracted the move-automation wizard footer controls into `components/move-automation/MoveAutomationDialogFooter.vue`.
- The dialog now delegates Cancel/Back/Next/Apply button presentation through focused emits while preserving the existing step gating and transaction apply flow.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation header component

- Extracted the move-automation dialog header/close button into `components/move-automation/MoveAutomationDialogHeader.vue`.
- Reduced `MoveAutomationDialog` to wizard state/composition and preserved the dialog title ID, species heading, close action, and header styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map admin ground-level control component

- Extracted the map admin ground-level input and explanatory copy into `components/map/MapAdminGroundLevelControl.vue`.
- Reduced `MapAdminPanel` to modal chrome plus summary display while preserving DOM event parsing, numeric bounds, and `set-ground-level-y` payload behavior.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map admin Y summary component

- Extracted the map admin absolute/map-specific Y summary list into `components/map/MapAdminYSummary.vue`.
- `MapAdminPanel` now composes focused ground-level input and summary components while preserving modal copy, values, and styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map admin header component

- Extracted the map admin modal heading and close button into `components/map/MapAdminHeader.vue`.
- Reduced `MapAdminPanel` to modal orchestration plus ground-level controls while preserving the Ctrl+Shift+A copy, title ID, close action, and header styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map admin modal shell

- Extracted the admin modal backdrop/dialog chrome into `components/map/MapAdminModalShell.vue`.
- `MapAdminPanel` now composes a modal shell, header, ground-level input, and Y summary with explicit events while preserving backdrop close behavior, ARIA dialog labelling, and panel styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation dialog shell

- Extracted the move-automation backdrop/dialog chrome into `components/move-automation/MoveAutomationDialogShell.vue`.
- `MoveAutomationDialog` now focuses on wizard state and step composition while preserving backdrop close behavior, context-menu suppression, ARIA labelling, sizing, and dialog styling.
- Quality gates after this phase:
  - `npm test` — passes: 102 test files / 381 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: move automation wizard composable

- Extracted move-automation wizard state, selection, target resolution, suggestions, hazard-cell helpers, transaction building, and apply orchestration into `composables/move-automation/useMoveAutomationWizard.ts`.
- Reduced `MoveAutomationDialog` to a presentation/composition adapter over the focused wizard composable while preserving selected move defaults, target gating, roll actions, suggestion toggles, hazard text behavior, and transaction payloads.
- Added `tests/composables/move-automation/useMoveAutomationWizard.test.ts` for stage-delta record creation and core wizard selection/target/apply behavior.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library page layout

- Extracted duplicated maps/sheets library page layout and header spacing into `components/library/LibraryPageLayout.vue`.
- Updated map and sheet library routes to compose the shared layout while preserving app navigation, breadcrumbs, drag-state classing, grid/context-menu wiring, and page background/spacing styles.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: library context menu header

- Extracted the reusable library context-menu target heading into `components/library/LibraryContextMenuHeader.vue`.
- Reduced `LibraryContextMenu` to mode/focus orchestration and action/form rendering while preserving target-kind/label output, truncation, and header styling.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: library context menu action list

- Extracted the Move/Rename/Delete action list into `components/library/LibraryContextMenuActionList.vue`.
- `LibraryContextMenu` now delegates icon/button presentation to the focused action component while preserving menuitem roles, Phosphor icons, hover/focus styling, and action emits.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: library context menu mode forms

- Extracted the Rename, Move, and Delete context-menu modes into focused components:
  - `components/library/LibraryContextMenuRenameForm.vue`
  - `components/library/LibraryContextMenuMoveForm.vue`
  - `components/library/LibraryContextMenuDeleteConfirm.vue`
- Reduced `components/library/LibraryContextMenu.vue` to context-menu shell composition over header, action-list, and mode-specific components while preserving backdrop close behavior and menu positioning.
- Preserved rename input focus/select behavior, move select focus, disabled no-destination handling, error display, cancel/submit emits, and delete confirmation copy.
- Next remaining phase: continue small UI decomposition by extracting shared library context-menu form actions/styles or another focused library-page presentation component.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryContextMenu.test.ts` — passes: 1 test file / 5 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: library context menu form actions

- Extracted the shared Cancel/submit action row and button styles into `components/library/LibraryContextMenuFormActions.vue`.
- Updated the rename, move, and delete context-menu mode components to compose the shared actions with focused labels, disabled-state, and danger-variant props while preserving submit/close emits, rename input focus/select, move destination gating, and delete confirmation behavior.
- Removed button/action deep styles from `components/library/LibraryContextMenu.vue` so action-button presentation lives with the focused form-actions component.
- Next remaining phase: continue small library UI cleanup by extracting shared context-menu error/field primitives or another focused presentation component.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryContextMenu.test.ts` — passes: 1 test file / 5 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: library context menu form primitives

- Extracted shared context-menu form primitives into focused components:
  - `components/library/LibraryContextMenuFormPanel.vue`
  - `components/library/LibraryContextMenuField.vue`
  - `components/library/LibraryContextMenuError.vue`
- Updated the rename, move, and delete context-menu modes to compose the shared form panel, field, and error primitives while preserving input/select focus behavior, Escape close handling, submit events, error rendering, and delete confirmation copy.
- Removed the remaining form/field/error deep styles from `components/library/LibraryContextMenu.vue`, leaving the parent as the context-menu shell and mode router.
- Next remaining phase: continue small bounded cleanup by extracting another focused library/map/reference presentation component or helper; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryContextMenu.test.ts` — passes: 1 test file / 5 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library intro search and errors

- Extracted duplicated maps/sheets library intro search-field markup, trimmed input handling, focus styling, and screen-reader label into `components/library/LibraryIntroSearchField.vue`.
- Extracted duplicated library intro alert/error rendering into `components/library/LibraryIntroErrors.vue` and wired map/sheet load/create/move errors through the shared component.
- Reduced `MapLibraryIntroPanel` and `SheetLibraryIntroPanel` to route-specific copy/actions while preserving search placeholders, trimmed search updates, alert copy, and visual styling.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library intro panel chrome and actions

- Extracted shared maps/sheets library intro panel chrome into `components/library/LibraryIntroPanelCard.vue` for the card shell, title, and badge presentation.
- Extracted shared intro action primitives into `components/library/LibraryIntroActionRow.vue` and `components/library/LibraryIntroActionButton.vue`.
- Updated map and sheet library intro panels to compose the shared panel/action components while preserving copy, search fields, GM/player gating, new-map/new-folder/new-sheet actions, sheet dropdown behavior, and intro error rendering.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library new-sheet menu component

- Extracted the sheet library New sheet dropdown and transparent backdrop into `components/library/SheetLibraryNewSheetMenu.vue`.
- Reduced `SheetLibraryIntroPanel` so it owns only sheet-library copy/search/action composition while the new component owns Pokémon/trainer menu presentation, disabled state, ARIA menu attributes, and close/toggle/create emits.
- Preserved sheet creation choices, dropdown/backdrop behavior, GM-only action visibility, intro search, create-folder action, and intro error rendering.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library card component

- Extracted Pokémon/trainer sheet card presentation from `components/library/SheetLibraryGrid.vue` into `components/library/SheetLibraryCard.vue`.
- Reduced the sheet library grid so it owns folder/grid/empty-state composition while the new card component owns sheet route links, sprites, badges, metadata, drag state styling, and context/drag event forwarding.
- Preserved Pokémon/trainer sheet card routes, shiny/type badges, trainer metadata, drag/drop behavior, context-menu event payloads, and empty-state copy.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library card component

- Extracted map card presentation from `components/library/MapLibraryGrid.vue` into `components/library/MapLibraryCard.vue`.
- Reduced the map library grid so it owns folder/grid/empty-state composition while the new card component owns map editor links, map metadata, visibility badge styling, and context/drag event forwarding.
- Preserved map card routes, dimensions/token-count copy, GM-only Player visible badge display, drag/drop behavior, context-menu event payloads, and empty-state copy.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library grid section shell

- Extracted the duplicated maps/sheets library grid shell, responsive grid CSS, loading/search-empty/default-empty state handling, and empty-state styling into `components/library/LibraryGridSection.vue`.
- Updated `MapLibraryGrid` and `SheetLibraryGrid` to compose the shared grid section while preserving folder tiles, map/sheet cards, loading copy, search-empty copy, GM/player empty-state copy, and drag/context event forwarding.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library card shell

- Extracted the shared maps/sheets library card link, hover, draggable, dragging-self, and accented-card chrome into `components/library/LibraryCardShell.vue`.
- Updated `MapLibraryCard` and `SheetLibraryCard` to compose the shared shell while preserving map editor/sheet editor routes, card metadata, trainer accent styling, drag/context-menu event payloads, and visual hover/drag behavior.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/mapLibrary.test.ts tests/utils/sheetLibrary.test.ts` — passes: 2 test files / 16 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library card media tile

- Extracted the shared maps/sheets library card media tile into `components/library/LibraryCardMedia.vue`.
- Updated `MapLibraryCard` and `SheetLibraryCard` to compose the shared media component for map icons, Pokémon sprites/fallbacks, and trainer icons while preserving card routes, drag/context events, sprite rendering, icon sizing, and visual styling.
- Removed duplicated media-tile image/fallback CSS from the map and sheet card components so the card components focus on domain-specific metadata.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/mapLibrary.test.ts tests/utils/sheetLibrary.test.ts` — passes: 2 test files / 16 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library card text primitive

- Extracted shared library card title/subtitle/body typography into `components/library/LibraryCardText.vue`.
- Updated map and sheet library cards to compose the shared text primitive while preserving map dimensions/token metadata, Player visible badges, Pokémon shiny/type metadata, trainer class metadata, routes, and drag/context event wiring.
- Removed duplicated card heading/body/subtitle CSS from the map and sheet card components so domain cards now focus on their specific metadata and badges.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/mapLibrary.test.ts tests/utils/sheetLibrary.test.ts` — passes: 2 test files / 16 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library card badge and meta primitives

- Extracted reusable library-card badge styling into `components/library/LibraryCardBadge.vue` for map Player-visible and Pokémon shiny badges.
- Extracted reusable sheet-card metadata chip layout into `components/library/LibraryCardMetaList.vue` so Pokémon/trainer card metadata uses one primitive instead of route-card-local list CSS.
- Updated `MapLibraryCard` and `SheetLibraryCard` to compose those primitives while preserving map visibility badges, shiny badges, Pokémon type badges, trainer metadata, routes, and drag/context event wiring.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/mapLibrary.test.ts tests/utils/sheetLibrary.test.ts` — passes: 2 test files / 16 tests.
  - `npm test` — passes: 103 test files / 383 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library folder creation composable

- Extracted duplicated maps/sheets library `new_folder`, `new_folder_1`, ... allocation, busy-state gating, create-error normalization, and post-create callbacks into `composables/library/useLibraryFolderCreation.ts`.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to inject their route-specific create-folder API calls and local folder-set updates through the shared composable while preserving current-folder placement, GM/dev gating, map `clientId` payloads, and intro-panel button/error behavior.
- Added `tests/composables/library/useLibraryFolderCreation.test.ts` covering next-name allocation, successful persistence callbacks, blocked/busy guards, and normalized error messages.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryFolderCreation.test.ts tests/composables/library/useLibraryDragDrop.test.ts tests/composables/library/useLibraryContextMenu.test.ts` — passes: 3 test files / 14 tests.
  - `npm test` — passes: 104 test files / 387 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library drop-move persistence composable

- Extracted maps/sheets library drag-drop move busy/error handling into `composables/library/useLibraryDropMove.ts`.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to inject route-specific move persistence and drop-payload capture into the shared composable while preserving map `clientId` payloads, sheet dev/GM gating, folder moves, local optimistic updates, and sheets move-error logging.
- Added `tests/composables/library/useLibraryDropMove.test.ts` covering invalid drops, successful async persistence, normalized error handling, optional error hooks, and explicit payload persistence.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryDropMove.test.ts tests/composables/library/useLibraryDragDrop.test.ts tests/composables/library/useLibraryFolderCreation.test.ts` — passes: 3 test files / 13 tests.
  - `npm test` — passes: 105 test files / 391 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library context-menu submit flow

- Extracted the duplicated maps/sheets library context-menu submit state machine into `composables/library/useLibraryContextSubmit.ts`.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to inject route-specific move, rename, and delete persistence handlers while the shared composable owns busy/error lifecycle, rename validation, error normalization, and close-on-success behavior.
- Added `tests/composables/library/useLibraryContextSubmit.test.ts` covering missing/busy guards, move/rename/delete submission, blank rename validation, and normalized handler errors.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryContextSubmit.test.ts tests/composables/library/useLibraryContextMenu.test.ts` — passes: 2 test files / 10 tests.
  - `npm test` — passes: 106 test files / 396 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library creation composable

- Extracted sheet library new-sheet dropdown/creation state into `composables/library/useSheetLibraryCreation.ts`.
  - The composable now owns menu open/close state, create busy/error lifecycle, creation gating, normalized error messages, and the hard-navigation callback boundary.
- Updated `pages/sheets/index.vue` to inject the `/api/sheets/create` request and sheet-editor navigation while preserving GM/dev gating, current-folder placement, Pokémon/trainer choices, hard navigation after creation, and create-error behavior.
- Added `tests/composables/library/useSheetLibraryCreation.test.ts` covering menu gating, successful create/navigation, busy/blocked guards, and normalized creation errors.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useSheetLibraryCreation.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 107 test files / 400 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library creation composable

- Extracted map library new-map creation state into `composables/library/useMapLibraryCreation.ts`.
  - The composable owns GM/busy gating, shared create busy/error refs, `/api/maps/create` lifecycle orchestration through injected callbacks, map-summary insertion, navigation callback boundaries, and normalized create errors.
- Updated `pages/maps/index.vue` to inject the concrete map-create request, local summary update, and map-editor navigation while preserving current-folder placement, `clientId` payloads, shared New map/New folder disabled state, intro-panel error behavior, and map-card routes.
- Added `tests/composables/library/useMapLibraryCreation.test.ts` covering successful create/navigation, injected shared busy/error state, blocked creation, and normalized creation errors.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useMapLibraryCreation.test.ts tests/composables/library/useLibraryFolderCreation.test.ts` — passes: 2 test files / 8 tests.
  - `npm test` — passes: 108 test files / 404 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library intro copy and controls

- Extracted duplicated maps/sheets library intro explanatory-copy styling into `components/library/LibraryIntroCopy.vue`.
  - The shared component owns intro-copy spacing, hint styling, and slotted code formatting while each intro panel keeps route-specific copy.
- Extracted duplicated intro search/action flex layout into `components/library/LibraryIntroControls.vue`.
- Updated map and sheet library intro panels to compose the shared copy/control primitives while preserving map/sheet copy, GM/player hint text, search fields, and create actions.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test` — passes: 108 test files / 404 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library data composable

- Extracted map-library list/folder loading, loading/error state, refresh orchestration, and `maps` realtime event application into `composables/library/useMapLibraryData.ts`.
- Updated `pages/maps/index.vue` to consume the focused data composable while preserving `/api/maps/list`, `/api/maps/folders`, `maps` channel realtime updates, clientId echo suppression, player-visible filtering, and existing map/folder context actions.
- Added `tests/composables/library/useMapLibraryData.test.ts` covering injected refresh fetchers, normalized load errors that keep prior state intact, and realtime subscription/client echo suppression.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useMapLibraryData.test.ts tests/utils/mapLibrary.test.ts` — passes: 2 test files / 11 tests.
  - `npm test` — passes: 109 test files / 407 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library data composable

- Extracted sheet-library static item derivation, local override/delete state, folder-set derivation, and persisted empty-folder loading into `composables/library/useSheetLibraryData.ts`.
- Updated `pages/sheets/index.vue` to consume the focused data composable while preserving player-only filtering, species type/sprite fallbacks, optimistic move/rename/delete overrides, GM/dev folder loading, and existing sheet/folder context actions.
- Added `tests/composables/library/useSheetLibraryData.test.ts` covering injected folder fetchers, player filtering, optimistic override/delete state, disabled folder loading, and normalized folder-load errors.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useSheetLibraryData.test.ts tests/composables/library/useMapLibraryData.test.ts` — passes: 2 test files / 7 tests.
  - `npm test` — passes: 110 test files / 411 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.


## Next phase update: sheet library action orchestration composable

- Extracted sheet-library drag/drop move, context-menu target labels/destinations, rename, and delete orchestration into `composables/library/useSheetLibraryActions.ts`.
  - The composable owns injected sheet/folder persistence calls plus local optimistic overrides, folder rename logs, deleted-sheet/deleted-folder state, and current-folder follow-up navigation.
- Updated `pages/sheets/index.vue` to delegate sheet/folder move, rename, delete, and context-menu helper logic to the focused composable while preserving dev/GM gating, sheet editor routes, folder breadcrumbs, drag/drop behavior, and local optimistic UI updates.
- Added `tests/composables/library/useSheetLibraryActions.test.ts` covering drop validity, sheet/folder moves, context-menu labels/destinations, renames with follow-up navigation, and sheet/folder subtree deletion state.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useSheetLibraryActions.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 111 test files / 415 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map library action orchestration composable

- Extracted map-library drag/drop move, context-menu target labels/destinations, rename, and delete orchestration into `composables/library/useMapLibraryActions.ts`.
  - The composable owns injected map/folder persistence calls plus optimistic map/folder collection updates, folder rename refresh/follow-up navigation, and context-menu helper derivations.
- Updated `pages/maps/index.vue` to delegate map/folder move, rename, delete, and context-menu helper logic to the focused composable while preserving GM gating, clientId payloads, map editor routes, folder breadcrumbs, drag/drop behavior, and local optimistic UI updates.
- Added `tests/composables/library/useMapLibraryActions.test.ts` covering drop validity, map/folder moves, context-menu labels/destinations, map/folder renames with current-folder follow-up navigation, and map/folder subtree deletion state.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useMapLibraryActions.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 112 test files / 419 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared library grid view composable

- Extracted shared maps/sheets library search, visible-card derivation, direct child folder tile derivation, empty-state detection, and badge counts into `composables/library/useLibraryGridView.ts`.
- Updated `pages/maps/index.vue` and `pages/sheets/index.vue` to consume the shared grid-view composable while preserving current-folder behavior, subtree search behavior, folder tile labels/counts, map count, and sheet filtered/total count badges.
- Added `tests/composables/library/useLibraryGridView.test.ts` covering visible item derivation, folder tile generation, hidden folders during search, optional filtered counters, and total counts.
- Next remaining phase: continue one small bounded cleanup pass on remaining library/map/reference presentation or helper duplication; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/library/useLibraryGridView.test.ts tests/composables/library/useMapLibraryData.test.ts tests/composables/library/useSheetLibraryData.test.ts` — passes: 3 test files / 9 tests.
  - `npm test` — passes: 113 test files / 421 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map create use-case extraction

- Extracted `/api/maps/create` orchestration into `server/useCases/createMap.ts`.
  - The use case now owns map-name normalization, folder sanitization, dimension clamping, slug allocation, default map document construction, persistence path selection, and `maps` channel create-event construction behind injectable dependencies.
- Reduced `server/api/maps/create.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing create-map behavior: optional/absent request bodies still create an Untitled Map, dimensions clamp to 1..200 with defaults, folders are sanitized with empty root allowed, JSON persistence still uses `writeMapFile`, and the response remains `{ map }`.
- Added `tests/server/createMap.test.ts` covering input normalization, default creation, bad long names, folder sanitizer failures, dimension clamping, write path selection, and realtime summary payloads.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/rename.post.ts`, `server/api/maps/move.post.ts`, and map folder mutation endpoints; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/createMap.test.ts` — passes: 1 test file / 5 tests.
  - `npm test` — passes: 114 test files / 426 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map rename use-case extraction

- Extracted `/api/maps/rename` orchestration into `server/useCases/renameMap.ts`.
  - The use case now owns slug/name validation, current-map lookup, slug-change decisions, unique slug allocation fallback, filesystem rename/write calls behind injectable dependencies, response path formatting, and compatible realtime event construction.
- Reduced `server/api/maps/rename.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing rename behavior: blank/long names and bad slugs keep compatible status messages, names that slugify to the current slug only update metadata, slug-changing renames emit old/new map events plus a `maps` rename event, and conflict/not-found responses remain compatible.
- Added `tests/server/renameMap.test.ts` covering in-place display-name updates, slug-changing file renames, allocated slug fallback when the desired slug exists elsewhere, bad input, missing maps, and destination conflicts.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/move.post.ts` and map folder mutation endpoints; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/renameMap.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 115 test files / 430 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map move use-case extraction

- Extracted `/api/maps/move` orchestration into `server/useCases/moveMap.ts`.
  - The use case now owns slug/folder validation, current-map lookup, destination path safety checks, same-path idempotence, destination conflict handling, filesystem move/prune/write calls behind injectable dependencies, response path formatting, and compatible realtime event construction.
- Reduced `server/api/maps/move.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing move behavior: empty folders move maps back to `data/maps`, same-path moves still refresh `updatedAt` and publish events, moved maps are re-read from the destination so `folder` remains path-derived, and conflict/not-found/status-message behavior remains compatible.
- Added `tests/server/moveMap.test.ts` covering moved maps, same-path moves, root moves, bad input, missing maps, destination conflicts, and escaped destination paths.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/create-folder.post.ts`, `server/api/maps/move-folder.post.ts`, and `server/api/maps/delete-folder.post.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/moveMap.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 116 test files / 434 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.


## Next phase update: map create-folder use-case extraction

- Extracted `/api/maps/create-folder` orchestration into `server/useCases/createMapFolder.ts`.
  - The use case now owns folder sanitization, maps-root path containment checks, existing-folder detection, directory creation behind injectable dependencies, response path formatting, and compatible `maps` channel folder-created events.
- Reduced `server/api/maps/create-folder.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing create-folder behavior: blank/invalid folder values still return bad-request messages from the sanitizer, existing folders return `created: false`, successful responses remain `{ ok, created, path }`, and realtime payloads remain `{ folder }`.
- Added `tests/server/createMapFolder.test.ts` covering folder normalization, existing-folder reporting, sanitizer failures, escaped-path protection, response paths, and realtime events.
- Next remaining phase: continue map folder endpoint thinning, especially `server/api/maps/move-folder.post.ts` and `server/api/maps/delete-folder.post.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/createMapFolder.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 117 test files / 438 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map move-folder use-case extraction

- Extracted `/api/maps/move-folder` orchestration into `server/useCases/moveMapFolder.ts`.
  - The use case now owns source/destination folder sanitization, descendant-move rejection, maps-root containment checks, source/destination filesystem checks, parent directory creation, folder rename/prune calls behind injectable dependencies, and compatible `maps` channel folder-moved events.
- Reduced `server/api/maps/move-folder.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing move-folder behavior: same-folder moves return `{ ok: true, moved: false }` without realtime events, missing or non-directory sources return the compatible not-found message, destination conflicts remain 409s, and successful responses remain `{ ok, moved }` with `{ from, to }` realtime payloads.
- Added `tests/server/moveMapFolder.test.ts` covering folder normalization, same-folder no-ops, sanitizer failures, descendant rejection, escaped-path protection, missing/non-directory sources, destination conflicts, filesystem calls, and realtime events.
- Next remaining phase: continue map folder endpoint thinning, especially `server/api/maps/delete-folder.post.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/moveMapFolder.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 118 test files / 442 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map delete-folder use-case extraction

- Extracted `/api/maps/delete-folder` orchestration into `server/useCases/deleteMapFolder.ts`.
  - The use case now owns folder sanitization, maps-root containment checks, folder existence/type checks, recursive removal/pruning calls behind injectable dependencies, response path formatting, and compatible `maps` channel folder-deleted events.
- Reduced `server/api/maps/delete-folder.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing delete-folder behavior: blank/invalid folders still return sanitizer bad-request messages, missing folders return `Folder "..." not found`, non-directory targets return `Not a directory`, successful responses remain `{ ok, removed }`, and realtime payloads remain `{ folder }`. The use case also explicitly rejects a sanitized root target before filesystem mutation as a safe-path hardening.
- Added `tests/server/deleteMapFolder.test.ts` covering folder normalization, recursive delete/prune calls, sanitizer failures, escaped/root target rejection, missing folders, non-directory targets, response paths, and realtime events.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/delete.post.ts`, `server/api/maps/list.get.ts`, `server/api/maps/load.get.ts`, and `server/api/maps/folders.get.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/deleteMapFolder.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 119 test files / 446 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.


## Next phase update: map delete use-case extraction

- Extracted `/api/maps/delete` orchestration into `server/useCases/deleteMap.ts`.
  - The use case now owns slug validation, map lookup, maps-root path safety checks, filesystem deletion/pruning through injectable dependencies, response path formatting, and compatible map/maps channel delete events.
- Reduced `server/api/maps/delete.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, realtime publish, and HTTP error translation.
- Preserved existing delete-map behavior: invalid slugs keep the compatible bad-request message, missing maps still return `Map <slug>.json not found`, successful responses remain `{ ok, path }`, and realtime payloads remain `{ slug }` on `map:<slug>` and `maps`.
- Added `tests/server/deleteMap.test.ts` covering successful deletion/pruning/events, invalid slugs, missing maps, and escaped/root path hardening before filesystem mutation.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/list.get.ts`, `server/api/maps/load.get.ts`, and `server/api/maps/folders.get.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/deleteMap.test.ts` — passes: 1 test file / 3 tests.
  - `npm test` — passes: 120 test files / 449 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map load use-case extraction

- Extracted `/api/maps/load` orchestration into `server/useCases/loadMap.ts`.
  - The use case now owns slug validation, map lookup, map read/invalid-document error mapping, and player-visible access checks behind injectable dependencies.
- Reduced `server/api/maps/load.get.ts` to a thin H3 adapter for auth, query extraction, use-case invocation, and HTTP error translation.
- Preserved existing load-map behavior: invalid slugs keep the compatible bad-request message, missing maps still return `Map <slug>.json not found`, invalid map documents still surface as 400s with the underlying map-storage error when available, and players cannot load maps that are not player-visible.
- Added `tests/server/loadMap.test.ts` covering GM/player loading, invalid slugs, missing maps, hidden-map player rejection, and invalid map read error mapping.
- Next remaining phase: continue map endpoint thinning, especially `server/api/maps/list.get.ts` and `server/api/maps/folders.get.ts`; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/loadMap.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 121 test files / 453 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map list/folders use-case extraction

- Extracted `/api/maps/list` and `/api/maps/folders` role-aware listing orchestration into `server/useCases/listMapLibrary.ts`.
  - The use case now owns GM-vs-player map summary visibility and player-hidden folder behavior behind injectable listing dependencies.
- Reduced `server/api/maps/list.get.ts` and `server/api/maps/folders.get.ts` to thin H3 adapters for auth plus use-case invocation.
- Preserved existing response shapes and behavior: GM map lists keep storage ordering/identity, players only receive `playerVisible` summaries, and players receive no map folders.
- Added `tests/server/listMapLibrary.test.ts` covering GM/player summary filtering, folder visibility, and storage-call suppression for player folder requests.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including auditing `server/api/events.get.ts`/SSE adapter boundaries or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/listMapLibrary.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 122 test files / 457 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: SSE stream helper extraction

- Extracted `/api/events` Server-Sent Events stream mechanics into `server/utils/sseStream.ts`.
  - The helper owns SSE headers, initial flush comments, JSON data-frame formatting, keepalive comments, write-error logging, and idempotent close/error cleanup through narrow request/response/subscriber interfaces.
- Reduced `server/api/events.get.ts` to a thin H3 adapter for auth plus realtime stream wiring while preserving the existing `/api/events` endpoint, headers, `: ok` initial comment, `: ping` keepalive cadence, `data: ...` event-frame format, and realtime subscription behavior.
- Added `tests/server/sseStream.test.ts` covering SSE frame formatting, event-stream headers, subscribed event writes, keepalive pings, write-failure logging, and single cleanup on close/error.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including another small server adapter/use-case cleanup or focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/sseStream.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 123 test files / 461 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generate use-case extraction

- Extracted `/api/encounters/generate` orchestration into `server/useCases/generateEncounters.ts`.
  - The use case now owns request normalization, encounter-table loading, deterministic roll injection for tests, output-directory/preview-temp selection, slug-prefix construction, sequential `pokegen.sh` execution, generated-file attribution, failure collection, preview cleanup, and HTTP-compatible error mapping behind injectable dependencies.
- Reduced `server/api/encounters/generate.post.ts` to a thin H3 adapter for GM auth, body reading, use-case invocation, and HTTP error translation.
- Preserved existing encounter generation behavior: response shape including `beforeCount`, persisted vs preview output handling, temp preview cleanup, sequential pokegen runs, generated sheet slug-prefix semantics, and validation/not-found status messages.
- Added `tests/server/generateEncounters.test.ts` covering persisted generation, preview generation/content cleanup, pokegen failure/no-new-file handling, and validation/missing-table errors.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including decoupling remaining server utilities from H3-specific errors where useful or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/generateEncounters.test.ts tests/server/encounterGeneration.test.ts` — passes: 2 test files / 10 tests.
  - `npm test` — passes: 124 test files / 465 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter generation typed input errors

- Decoupled `server/utils/encounterGeneration.ts` from H3 by replacing direct `createError` usage with a typed `EncounterGenerationInputError` that carries HTTP-compatible `statusCode`/`statusMessage` metadata.
- Updated `generateEncountersUseCase` error normalization to map the typed helper error into `GenerateEncountersUseCaseError` explicitly, keeping API response status/messages compatible while keeping validation helpers framework-agnostic.
- Expanded encounter generation helper tests to assert typed input errors and preserve existing sanitizer/path/count behavior.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including decoupling another server boundary from H3-specific details where useful or a focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/encounterGeneration.test.ts tests/server/generateEncounters.test.ts` — passes: 2 test files / 11 tests.
  - `npm test` — passes: 124 test files / 466 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet save use-case extraction

- Extracted `/api/sheets/save` orchestration into `server/useCases/saveSheet.ts`.
  - The use case now owns payload-slug validation, persisted-sheet lookup, player-access enforcement, derived `folder` stripping, player-access preservation for player saves, write persistence, response path formatting, and compatible sheet/sheets realtime update events behind injectable dependencies.
- Reduced `server/api/sheets/save.post.ts` to a thin H3 adapter for auth, non-production gating, request validation, use-case invocation, realtime publishing, and HTTP error translation.
- Preserved existing save-sheet behavior: request/response shape stays `{ ok, path }`, invalid slug mismatches keep the same status message, missing sheets remain 404s, player saves still require player-accessible sheets and force `player: true`, `folder` remains derived/not persisted, and realtime channels remain `sheet:<kind>:<slug>` plus `sheets` with clientId echo suppression support.
- Added `tests/server/saveSheet.test.ts` covering GM saves, player-accessible saves, slug mismatch rejection, missing-sheet errors, inaccessible player saves, stripped derived fields, writes, response paths, and realtime event payloads.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including extracting additional sheet mutation/folder use cases or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/saveSheet.test.ts` — passes: 1 test file / 5 tests.
  - `npm test` — passes: 125 test files / 471 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet rename use-case extraction

- Extracted `/api/sheets/rename` orchestration into `server/useCases/renameSheet.ts`.
  - The use case now owns sheet rename persistence invocation, not-found/error mapping, response path/name formatting, and compatible sheet/sheets realtime update events behind injectable dependencies.
- Reduced `server/api/sheets/rename.post.ts` to a thin H3 adapter for GM auth, non-production gating, request validation, use-case invocation, realtime publishing, and HTTP error translation.
- Preserved existing rename-sheet behavior: request/response shape stays `{ ok, name, path }`, missing sheets remain `Sheet <slug>.json not found`, parse/write failures keep the existing `Failed to parse or write sheet: ...` server-error message, and realtime channels remain `sheet:<kind>:<slug>` plus `sheets` with clientId echo suppression support.
- Added `tests/server/renameSheet.test.ts` covering successful rename events, missing-sheet errors, and parse/write error mapping.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including extracting sheet move/delete/folder use cases or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/renameSheet.test.ts` — passes: 1 test file / 3 tests.
  - `npm test` — passes: 126 test files / 474 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet move use-case extraction

- Extracted `/api/sheets/move` orchestration into `server/useCases/moveSheet.ts`.
  - The use case now owns sheet move persistence invocation, missing-sheet/error mapping, response path/moved-state formatting, and compatible `sheets` channel moved events behind injectable dependencies.
- Reduced `server/api/sheets/move.post.ts` to a thin H3 adapter for GM auth, non-production gating, request validation, use-case invocation, realtime publishing, and HTTP error translation.
- Preserved existing move-sheet behavior: request/response shape stays `{ ok, moved, path }`, missing sheets remain `Sheet <slug>.json not found`, destination conflicts remain 409s with the storage message, other storage validation errors remain 400s, and realtime payloads remain `type: 'moved'` on the `sheets` channel with clientId echo suppression support.
- Added `tests/server/moveSheet.test.ts` covering successful moves/events, same-folder no-op responses, missing-sheet errors, and conflict/bad-request error mapping.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including extracting sheet delete/folder use cases or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/moveSheet.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 127 test files / 478 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet delete use-case extraction

- Extracted `/api/sheets/delete` orchestration into `server/useCases/deleteSheet.ts`.
  - The use case now owns sheet delete persistence invocation, missing-sheet error mapping, response path formatting, and compatible sheet/sheets realtime delete events behind injectable dependencies.
- Reduced `server/api/sheets/delete.post.ts` to a thin H3 adapter for GM auth, non-production gating, request validation, use-case invocation, realtime publishing, and HTTP error translation.
- Preserved existing delete-sheet behavior: request/response shape stays `{ ok, path }`, missing sheets remain `Sheet <slug>.json not found`, unexpected filesystem/storage failures still bubble to server-error handling, and realtime channels remain `sheet:<kind>:<slug>` plus `sheets` with clientId echo suppression support.
- Added `tests/server/deleteSheet.test.ts` covering Pokémon/trainer deletion events, missing-sheet errors, and unexpected storage-failure bubbling.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including extracting sheet folder/create use cases or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/deleteSheet.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 128 test files / 482 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet create use-case extraction

- Extracted `/api/sheets/create` orchestration into `server/useCases/createSheet.ts`.
  - The use case now owns sheet creation persistence invocation, response path/slug formatting, and compatible `sheets` channel update events behind injectable dependencies.
- Reduced `server/api/sheets/create.post.ts` to a thin H3 adapter for GM auth, non-production gating, request validation, use-case invocation, realtime publishing, and response formatting.
- Preserved existing create-sheet behavior: request/response shape stays `{ ok, kind, slug, path }`, Pokémon/trainer default sheet creation still comes from `sheetStorage`, folder remains path-derived and included in the realtime sheet payload, and `clientId` echo suppression metadata remains on the `sheets` event.
- Added `tests/server/createSheet.test.ts` covering Pokémon/trainer creation events, root-folder payloads, storage-derived folder payloads, and unexpected storage-failure bubbling.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including extracting sheet folder create/move/delete/list use cases or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/createSheet.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 129 test files / 486 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.


## Next phase update: sheet folder use-case extraction

- Extracted sheet folder create/move/delete/list orchestration into H3-free use cases:
  - `server/useCases/createSheetFolder.ts`
  - `server/useCases/moveSheetFolder.ts`
  - `server/useCases/deleteSheetFolder.ts`
  - `server/useCases/listSheetFolders.ts`
- Reduced `/api/sheets/create-folder`, `/api/sheets/move-folder`, `/api/sheets/delete-folder`, and `/api/sheets/folders` to thin H3 adapters for auth, non-production gating, body reading, use-case invocation, and HTTP error translation.
- Preserved existing sheet-folder behavior: create-folder still targets the Pokémon sheet root, move/delete still operate across Pokémon and trainer sheet roots, player folder listing still returns `[]` without invoking the non-production guard, response shapes remain compatible, and no new realtime folder events were introduced.
- Added `tests/server/sheetFolders.test.ts` covering folder sanitization, create/move/delete/list success paths, missing-folder errors, conflict mapping, player folder hiding, and unexpected create-storage error bubbling.
- Next remaining phase: continue one bounded cleanup pass, with remaining candidates including decoupling another small server boundary from H3-specific details or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/sheetFolders.test.ts` — passes: 1 test file / 7 tests.
  - `npm test` — passes: 130 test files / 493 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: server use-case HTTP adapter helper

- Added `server/utils/useCaseHttp.ts` to centralize two H3 adapter concerns for thin route handlers:
  - translating HTTP-compatible use-case errors into `createError` responses;
  - publishing use-case realtime event arrays through the in-process realtime adapter.
- Updated map, sheet, map-load, and encounter-generation route adapters to use the shared helper instead of importing individual use-case error classes or repeating realtime publish loops inline.
- Preserved existing endpoint response shapes, status codes/status messages, realtime channels, and clientId echo-suppression payloads; use cases remain H3-free.
- Added `tests/server/useCaseHttp.test.ts` covering HTTP-compatible error recognition/translation and realtime event fan-out.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting shared use-case error base classes, autosave resource helpers, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/useCaseHttp.test.ts tests/server/createMap.test.ts tests/server/saveSheet.test.ts tests/server/generateEncounters.test.ts` — passes: 4 test files / 17 tests.
  - `npm test` — passes: 131 test files / 496 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared use-case error base class

- Added `server/utils/useCaseErrors.ts` with a reusable `UseCaseHttpError` base class plus a structural guard for HTTP-compatible use-case errors.
- Updated map, sheet, encounter-generation, and encounter input error classes to extend the shared base class instead of each re-declaring `statusCode` constructors.
- Updated `server/utils/useCaseHttp.ts` to reuse the shared guard while preserving H3 adapter behavior and realtime event publishing.
- Added `tests/server/useCaseErrors.test.ts` covering subclass status/message/name preservation and HTTP-error guard behavior.
- Next remaining phase: continue one bounded cleanup pass, with candidates including autosave resource helpers or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/server/useCaseErrors.test.ts tests/server/useCaseHttp.test.ts tests/server/createMap.test.ts tests/server/saveSheet.test.ts tests/server/generateEncounters.test.ts` — passes: 5 test files / 19 tests.
  - `npm test -- tests/server/useCaseErrors.test.ts tests/server/useCaseHttp.test.ts` — passes after removing a duplicate Nuxt auto-import warning: 2 test files / 5 tests.
  - `npm test` — passes: 132 test files / 498 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave timer and sequence helpers

- Added `utils/autosave.ts` with reusable debounced-task scheduling and latest-save sequence guards for client-side autosave flows.
- Updated `useEditableMap` and `useEditableSheet` to use the shared autosave helpers instead of each owning pending timer cancellation and stale-save sequence bookkeeping inline.
- Preserved map autosave behavior, sheet autosave behavior, clientId echo suppression, sheet unload beacon flushing, map rename pending-save cancellation, and stale save-result guards.
- Added `tests/utils/autosave.test.ts` covering debounce cancellation, immediate saves, pending flushes, and latest-sequence detection.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting more shared autosave resource state, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 4 tests.
  - `npm test` — passes: 133 test files / 502 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave snapshot tracker

- Added `createAutosaveSnapshotTracker` to `utils/autosave.ts` to centralize last-clean JSON snapshot tracking for autosaved resources.
- Updated `useEditableMap` and `useEditableSheet` to use the shared snapshot tracker instead of each mutating/comparing `lastServerJson` inline.
- Preserved map autosave/reload/realtime rename behavior, sheet persisted-payload comparison, clientId echo suppression, and sheet unload clean-state marking.
- Expanded `tests/utils/autosave.test.ts` to cover empty initial snapshots, dirty/clean comparisons, and adopting precomputed payload JSON.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting sheet unload/beacon helpers, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 7 tests.
  - `npm test` — passes: 133 test files / 505 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave unload helpers

- Added unload-autosave helpers to `utils/autosave.ts` for JSON `sendBeacon`/`fetch(..., keepalive)` dispatch and idempotent `pagehide`/`beforeunload` listener binding.
- Updated `useEditableSheet` to delegate beacon/keepalive save attempts and unload listener registration to the shared autosave helpers while preserving persisted payload shape, clientId echo suppression metadata, pending-save cancellation, and clean-snapshot marking on unload.
- Expanded `tests/utils/autosave.test.ts` to cover beacon preference, keepalive fetch fallback, transport failure reporting, and unload listener cleanup.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting more shared autosave resource state, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 11 tests.
  - `npm test` — passes: 133 test files / 509 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave status controller

- Added `createAutosaveStatusController` to `utils/autosave.ts` to centralize common autosave status/error transitions, error normalization, and optional save-error logging behind narrow ref-shaped inputs.
- Updated `useEditableMap` and `useEditableSheet` to use the shared controller for saving/saved/error transitions while preserving debounce behavior, latest-save guards, map load errors, sheet unload flushing, and existing error copy/log prefixes.
- Expanded `tests/utils/autosave.test.ts` to cover status transitions, error normalization, injected fallbacks, and logging behavior.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting additional autosave save-runner/resource helpers, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 14 tests.
  - `npm test` — passes: 133 test files / 512 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave save runner

- Added `runLatestAutosave` to `utils/autosave.ts` to centralize autosave request sequencing, saving/saved transitions, stale-save suppression, latest-error handling, and resource-specific success/error hooks.
- Updated `useEditableMap` and `useEditableSheet` to delegate their common save-runner flow to the shared helper while preserving map updatedAt adoption, sheet persisted-payload snapshot marking, clientId echo suppression, debounce behavior, and existing save-error log prefixes.
- Expanded `tests/utils/autosave.test.ts` to cover latest successful saves, stale-success status suppression, stale-error suppression, and latest-error normalization/logging.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting additional autosave resource helpers, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 17 tests.
  - `npm test` — passes: 133 test files / 515 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave dirty scheduler

- Added `createAutosaveDirtyScheduler` to `utils/autosave.ts` to centralize clean-snapshot checks, pending-status hooks, and debounced save scheduling for autosaved resources.
- Updated `useEditableMap` and `useEditableSheet` watchers to use the shared dirty scheduler instead of each repeating clean-check/status/schedule logic inline.
- Preserved existing autosave behavior by keeping map/sheet-specific pending status hooks outside the helper, including the previous timing for clearing or retaining displayed save errors.
- Expanded `tests/utils/autosave.test.ts` to cover dirty/non-dirty scheduling and caller-owned pending/error semantics.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting additional autosave resource helpers, addressing the documented broader typecheck backlog, or another focused UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 19 tests.
  - `npm test` — passes: 133 test files / 517 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared autosave resource controller

- Added `createAutosaveResourceController` to `utils/autosave.ts` to bundle the common editable-resource setup for status control, clean-snapshot tracking, latest-save guards, debounced tasks, and dirty scheduling behind a narrow controller.
- Updated `useEditableMap` and `useEditableSheet` to use the shared resource controller while keeping map/sheet-specific save payloads, realtime handling, unload flushing, and pending-status semantics local.
- Preserved map autosave/reload/rename behavior, sheet persisted-payload comparisons, clientId echo suppression, sheet unload beacon behavior, stale-save guards, and public `saveNow`/cancel APIs.
- Expanded `tests/utils/autosave.test.ts` to cover resource-controller bundling, dirty scheduling, debounce cancellation, immediate save wrappers, snapshot tracking, and save guard exposure.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting another focused autosave helper, addressing the documented broader typecheck backlog, or another UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/autosave.test.ts` — passes: 1 test file / 21 tests.
  - `npm test` — passes: 133 test files / 519 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared realtime client-id helpers

- Added `normalizeRealtimeClientId` and `isRealtimeEcho` to `shared/realtime.ts` so realtime request adapters and client subscribers share one client-id boundary/echo-suppression rule.
- Updated editable map/sheet autosave subscribers and map-library realtime application to use the shared echo helper instead of direct `event.clientId === clientId` checks.
- Updated map and sheet mutation/folder API adapters to normalize optional `clientId` values through the shared helper before passing them into H3-free use cases, preserving string client IDs and dropping non-string request values.
- Added `tests/shared/realtime.test.ts` covering channel helpers, client-id normalization, and missing-client-id echo behavior.
- Next remaining phase: continue one bounded cleanup pass, with candidates including extracting another focused autosave helper, addressing the documented broader typecheck backlog, or another UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/shared/realtime.test.ts tests/utils/mapLibrary.test.ts tests/composables/library/useMapLibraryData.test.ts` — passes: 3 test files / 14 tests.
  - `npm test` — passes: 134 test files / 522 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared map layer visibility helpers

- Centralized map layer defaults, canonical layer-option ordering, and partial visibility resolution in `utils/mapLayerVisibility.ts`.
- Updated the map editor route to initialize layer visibility from the shared helper instead of owning duplicated inline defaults/options.
- Updated map layer UI components to share the exported `MapLayerVisibilityKey` type, and updated isometric scene-state resolution to reuse the same map-layer defaults.
- Expanded `tests/utils/mapLayerVisibility.test.ts` to cover canonical layer ordering, independent default-state creation, and partial visibility resolution.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor helper extraction, addressing the documented broader typecheck backlog, or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/mapLayerVisibility.test.ts tests/utils/isometric/sceneState.test.ts` — passes: 2 test files / 9 tests.
  - `npm test` — passes: 134 test files / 525 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map access composable extraction

- Extracted map-editor access derivation and GM-mode cleanup watchers from `pages/maps/[slug].vue` into `composables/map-editor/useMapAccess.ts`.
  - The composable now owns GM-derived map edit/spawn/initiative capabilities, player-visible map access checks, hidden-map player redirects, and clearing GM-only UI state when GM access is lost.
- Updated the map editor route to consume the focused access/guard composables while preserving hidden-map redirects, build/hazard/admin reset behavior, selected-token cleanup, and move-automation cleanup for no-longer-controllable tokens.
- Added `tests/composables/map-editor/useMapAccess.test.ts` covering player visibility rules, redirect trigger compatibility, GM capability derivation, and GM-access-loss cleanup behavior.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor helper extraction, addressing the documented broader typecheck backlog, or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/map-editor/useMapAccess.test.ts` — passes: 1 test file / 6 tests.
  - `npm test` — passes: 135 test files / 531 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map dimension controls composable extraction

- Extracted map-editor geometry and dimension orchestration from `pages/maps/[slug].vue` into `composables/map-editor/useMapDimensions.ts`.
  - The composable now owns derived map voxel/hazard collections, ground-level bounds, map-specific Y-range values, player-visibility updates, dimension edits, ground-level clamping, and dimension-change reconciliation.
- Updated the map editor route to consume focused dimension controls while preserving map dimension inputs, admin ground-level editing, terrain/hazard filtering, selected-token cleanup, and token-placement reconciliation after dimension changes.
- Added `tests/composables/map-editor/useMapDimensions.test.ts` covering edit gating, ground-level derivations/clamping, dimension normalization, terrain/hazard trimming, placement reconciliation, and selection cleanup.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor helper extraction, addressing the documented broader typecheck backlog, or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/map-editor/useMapDimensions.test.ts` — passes: 1 test file / 2 tests.
  - `npm test` — passes: 136 test files / 533 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map editor UI state composable extraction

- Extracted map-editor chrome/state orchestration from `pages/maps/[slug].vue` into `composables/map-editor/useMapEditorUiState.ts`.
  - The composable now owns left/right sidebar collapse state, left-panel section collapse state, layer visibility state, editor mode switching, and Ctrl+Shift+A/Escape admin shortcut handling through an injectable keydown registration boundary.
- Updated the map editor route to consume the focused UI-state composable while preserving build/hazard mode gating, token selection clearing when entering edit modes, layer visibility behavior, sidebar collapse behavior, and admin panel shortcut behavior.
- Added `tests/composables/map-editor/useMapEditorUiState.test.ts` covering default section state, sidebar/layer toggles, mode transitions and edit gating, shortcut registration, admin shortcut handling, and non-GM shortcut suppression.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor helper extraction, addressing the documented broader typecheck backlog, or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/map-editor/useMapEditorUiState.test.ts` — passes: 1 test file / 6 tests.
  - `npm test` — passes: 137 test files / 539 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: map token navigation composable extraction

- Extracted map token sheet/Pokédex external-link orchestration from `pages/maps/[slug].vue` into `composables/map-editor/useMapTokenNavigation.ts`.
  - The composable now owns controlled-token lookup, sheet/Pokédex href resolution through an injected route resolver, species lookup, browser-open boundary, and boolean success results for tests.
- Updated the map editor route to consume the focused navigation composable while preserving right-click View sheet/View Pokédex behavior, permission gating, Pokémon-only Pokédex links, and new-tab `noopener` opening.
- Added `tests/composables/map-editor/useMapTokenNavigation.test.ts` covering href resolution, controlled-token opening, and blocked/missing/non-Pokémon navigation.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor helper extraction, addressing the documented broader typecheck backlog, or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/map-editor/useMapTokenNavigation.test.ts` — passes: 1 test file / 3 tests.
  - `npm test` — passes: 138 test files / 542 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: TypeScript typecheck backlog cleanup

- Resolved the documented broader `npm run typecheck` backlog without changing runtime data semantics.
  - Fixed low-risk Vue prop/slot typing issues in shared editable/reference/map field-effect components.
  - Added explicit imports for encounter-page composables that Nuxt typecheck did not auto-resolve.
  - Avoided Nuxt typed-route stack-depth issues in library/editable-sheet POST helpers by using narrow injected `$fetch` adapter casts at the request boundary.
  - Tightened catalog, sheet-normalization, sheet lookup, map/realtime helper, Pokédex, and move-automation test types so strict checking matches existing runtime shapes.
- Preserved behavior while making the typecheck quality gate meaningful for future phases.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction or another small UI/helper duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/composables/sheets/useEditableSheetResource.test.ts tests/utils/autosave.test.ts` — passes: 2 test files / 24 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 138 test files / 542 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: route slug boundary cleanup

- Reused the shared `routeSlugParam` helper in map and sheet slug route shells for route keys and base slug resolution instead of repeating direct `route.params.slug` coercion.
- Updated reference detail routes to compute a single normalized slug and pass it through to not-found cards, so templates no longer reach into raw route params.
- Tightened `ReferenceNotFoundCard` to accept a string slug boundary now that all callers normalize route params before rendering.
- Preserved existing slug string-coercion semantics, route keys, lookups, not-found copy, and public routes.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining UI helper duplication cleanup, or further route-shell tightening; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/routeParams.test.ts` — passes: 1 test file / 2 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 138 test files / 542 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: sheet library route constant cleanup

- Added `SHEET_LIBRARY_PATH` and `sheetLibraryPath()` to `utils/sheetRoutes.ts` so sheet-library navigation uses the same canonical route helper pattern as map routes.
- Updated sheet library folder navigation, app navigation, sheet page/not-found defaults, and encounter-generation intro links to consume the shared sheet-library path instead of repeating `/sheets` route strings.
- Updated trainer Current Team links to use `sheetEditorPath('pokemon', memberSlug)`, preserving normal team links while applying the same slug encoding used by every other Pokémon sheet editor route.
- Added route-helper coverage for the canonical sheet library path.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining route/helper constant cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/sheetRoutes.test.ts tests/utils/appNavigation.test.ts` — passes: 2 test files / 6 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 138 test files / 543 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: encounter/login route constant cleanup

- Added `utils/encounterRoutes.ts` for canonical encounter-generator and encounter-table route paths plus the GM-only encounter route prefix list.
- Updated app navigation, login redirect policy, auth middleware, logout routing, and encounter-page cross-links to consume shared route constants instead of repeating `/generate`, `/encounter-tables`, `/login`, and default `/maps` strings.
- Preserved existing route URLs, GM-only encounter-page gating, player redirect fallback behavior, logout navigation, and encounter-page link targets.
- Added `tests/utils/encounterRoutes.test.ts` and expanded login/app-navigation route-helper tests.
- Next remaining phase: continue one bounded cleanup pass, with candidates including remaining route/helper constant cleanup (for example Pokédex/reference paths), another focused map-editor/helper extraction, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/encounterRoutes.test.ts tests/utils/loginRedirect.test.ts tests/utils/appNavigation.test.ts` — passes: 3 test files / 10 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 139 test files / 546 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: Pokédex and reference route helper cleanup

- Added `utils/pokedex/routes.ts` for the canonical Pokédex path, path recognition, encoded entry paths, and species-to-entry route generation.
- Added `utils/reference/routes.ts` for canonical PTU reference index/detail paths and shared reference back-label formatting.
- Updated Pokédex browser scroll/page code, map token Pokédex links, app navigation, `RefLink`, reference detail shells, and reference list/detail links to use the shared route helpers instead of repeating `/pokedex`, `/moves`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, and `/edges` strings inline.
- Preserved existing public routes, route encoding behavior, reference back-link copy, Pokédex scroll preservation, and token sheet/Pokédex context-menu behavior.
- Added tests for the new Pokédex and reference route helpers and reused existing route/link tests to cover the migrated callers.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining helper constant cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/pokedex/routes.test.ts tests/utils/reference/routes.test.ts tests/utils/refLinks.test.ts tests/utils/appNavigation.test.ts tests/composables/map-editor/useTokenControls.test.ts tests/composables/pokedex/usePokedexSidebarScroll.test.ts tests/utils/pokedex/entryIndex.test.ts tests/composables/pokedex/usePokedexBrowser.test.ts` — passes: 8 test files / 28 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 141 test files / 552 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared app and legacy-grid route helpers

- Added `utils/appRoutes.ts` for canonical home/login route constants plus focused helpers for home/login path generation and exact-home matching.
- Moved app-navigation, auth middleware, logout navigation, cookie-path setup, and login-redirect tests to consume the shared app route constants instead of repeating `/` and `/login` boundaries inline.
- Extended `utils/legacyGridRoutes.ts` with a canonical legacy `/grids` path and predicate, then reused it in app-navigation active-route matching instead of keeping the legacy prefix string in navigation code.
- Preserved existing public routes, login redirect behavior, root-cookie path behavior, legacy `/grids` active-state behavior, and legacy grid redirect coercion semantics.
- Added `tests/utils/appRoutes.test.ts` and expanded legacy-grid route-helper coverage.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining helper constant cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/appRoutes.test.ts tests/utils/legacyGridRoutes.test.ts tests/utils/appNavigation.test.ts tests/utils/loginRedirect.test.ts` — passes: 4 test files / 13 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 142 test files / 555 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared client API route constants

- Added `utils/apiRoutes.ts` to centralize client-consumed API endpoint paths for realtime events, map CRUD/list endpoints, sheet CRUD/folder endpoints, and encounter generation.
- Updated editable map/sheet autosave, realtime SSE setup, map/sheet library data/actions, map token sheet persistence, and encounter generation requests to use the shared API path constants instead of repeating string literals inline.
- Preserved all existing API URLs, request bodies, clientId echo suppression, unload beacon sheet saves, library create/move/rename/delete behavior, and encounter generation behavior.
- Added `tests/utils/apiRoutes.test.ts` covering the centralized API route constants.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining helper constant cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/apiRoutes.test.ts tests/composables/library/useMapLibraryData.test.ts tests/composables/library/useSheetLibraryData.test.ts tests/composables/map-editor/useTokenSheetMutations.test.ts tests/composables/encounters/useEncounterGenerationPage.test.ts tests/utils/autosave.test.ts` — passes: 6 test files / 40 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 143 test files / 559 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared client API request helper

- Added `utils/apiClient.ts` plus `composables/useApiClient.ts` to centralize Nuxt `$fetch` request adaptation behind narrow `getJson` and `postJson` helpers.
- Updated editable map/sheet autosave, map/sheet library data/actions, token sheet persistence, and encounter generation requests to consume the shared API client instead of repeating `$fetch` casts or `{ method: 'POST', body }` request boilerplate.
- Preserved all existing API endpoints, request bodies, query params, clientId echo suppression, unload beacon behavior, and injected fetcher seams used by tests.
- Added `tests/utils/apiClient.test.ts` covering GET requests with/without params and POST JSON body forwarding.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining client helper cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/apiClient.test.ts tests/composables/library/useMapLibraryData.test.ts tests/composables/library/useSheetLibraryData.test.ts tests/composables/map-editor/useTokenSheetMutations.test.ts tests/composables/encounters/useEncounterGenerationPage.test.ts tests/utils/autosave.test.ts` — passes: 6 test files / 39 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 144 test files / 562 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.

## Next phase update: shared client-id provider helper

- Extracted client-id formatting and provider construction into `utils/clientId.ts` behind `formatClientId` and `createClientIdProvider`.
- Preserved the default `getClientId()` behavior: SSR calls return the `ssr` sentinel without caching, browser calls create one per-runtime ID using the existing random/date base36 format, and subsequent calls reuse the same ID for realtime echo suppression.
- Added `tests/utils/clientId.test.ts` covering deterministic formatting, SSR-to-browser transition behavior, and per-provider browser caching.
- Next remaining phase: continue one bounded cleanup pass, with candidates including another focused map-editor/helper extraction, remaining client helper cleanup, or small UI duplication cleanup; do not mark the full refactor complete yet.
- Quality gates after this phase:
  - `npm test -- tests/utils/clientId.test.ts` — passes: 1 test file / 3 tests.
  - `npm run typecheck` — passes.
  - `npm test` — passes: 145 test files / 565 tests.
  - `npm run build` — passes; existing large chunk warnings remain.
  - `npm run check:move-automation` — still fails with baseline `Explicit move automation coverage: 0/769` missing-script report.
