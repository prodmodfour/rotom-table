# Refactor notes

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

- `npm test` — passes: 5 test files / 13 tests.
- `npm run build` — passes; existing large chunk warnings remain.
- `npm run check:move-automation` — still fails with the same baseline `Explicit move automation coverage: 0/769` missing-script report.
- `npm run typecheck` — added but currently fails on pre-existing type issues in large untouched areas (`components/EditableCell.vue`, `components/IsometricGrid.client.vue`, catalog loaders, Pokédex page, sheet normalization helpers, etc.). The new/refactored sheet-route and storage files are not among the remaining reported errors.
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
