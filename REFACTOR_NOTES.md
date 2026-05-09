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
