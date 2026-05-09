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
