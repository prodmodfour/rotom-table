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
