# Prompt for Pi Coding Agent — Refactor `rotom-table` with GPT-5.5

You are GPT-5.5 acting as an autonomous coding agent on my Pi. Your task is to refactor the active `rotom_table` / `rotom-table` codebase that I have provided through GitHub access.

## Absolute scope rules

1. Work only on the active repository: `prodmodfour/rotom-table`.
2. The default branch is `main`; use the current checkout/branch as the source of truth.
3. Completely ignore `rotom_table_old`. Do not inspect it, compare against it, copy from it, import from it, or mention it in implementation notes except to confirm it was ignored.
4. Do not change game/data semantics unless the change is required to fix a discovered bug and is covered by tests or clearly documented.
5. Do not replace the whole app with a new architecture. Refactor incrementally, preserving behavior at every step.
6. Do not delete user data under `data/`, `ptu-data/`, `books/markdown/`, `public/`, `trainer_sizes/`, or `schemas/` unless you can prove the file is generated, unused, and deletion is explicitly part of cleanup. Prefer leaving content/data alone.
7. Do not break existing routes, URLs, JSON file formats, or public asset paths.

## Mission

Refactor the codebase so it follows:

- SOLID principles
- DRY principle
- Law of Demeter
- General software engineering good practice
- Strong TypeScript hygiene
- Maintainable Nuxt 3 / Vue 3 composition patterns
- Clear separation between domain logic, persistence, API adapters, UI state, and rendering

The refactor should make the app easier to test, easier to extend, easier to reason about, and safer to modify, while preserving current user-facing behavior.

## Current repository context to validate first

Before editing, inspect the current repo because it may have changed. My latest inspection suggests this is a Nuxt 3 TypeScript app with:

- `package.json` scripts: `dev`, `build`, `preview`, `postinstall`, `check:move-automation`, and `sync:item-sprites`.
- Runtime dependencies around Nuxt 3, Vue/Nitro via Nuxt, Three.js, Phosphor icons, and local font packages.
- App routes under `pages/`, including map, sheet, Pokédex, rules/reference, items, moves, abilities, capabilities, features, edges, conditions, grids, login, generate, and encounter table pages.
- Large client components under `components/`, especially `IsometricGrid.client.vue`.
- Client composables under `composables/`, including `useAuth`, `useEditableMap`, `useEditableSheet`, `useLiveSheets`, and `useRealtime`.
- Server endpoints under `server/api/`, especially map and sheet CRUD-style endpoints.
- Server utilities under `server/utils/`, including auth, realtime, and map storage.
- Domain-ish utilities under `utils/` for grid logic, voxels, map hazards, map field effects, map materials, placement, sheet spawning, sheet normalization, HP formulas, type charts, combat stages, status conditions, item sprites, and move automation.
- Data loaders under `data/`, including `characterSheets.ts`, `trainerSheets.ts`, `ptuReference.ts`, and static JSON content.
- Types under `types/`, including map, Pokémon, character sheet, trainer sheet, combat stages, and move automation.
- Filesystem-backed JSON documents under `data/sheets`, `data/trainers`, and `data/maps`.
- Realtime updates implemented with an in-process SSE/pub-sub mechanism.
- Auth currently based on a role cookie with `gm` and `player` roles.

Treat this section as a starting hypothesis only. Verify the current code before changing it.

## Primary design target

Move the app toward this layering model:

```text
UI / interface layer
  pages/*.vue
  components/*.vue
  composables used directly by components
  Nuxt server route handlers under server/api

Application layer
  use cases / orchestration services
  autosave resource state machines
  map editor orchestration
  sheet editor orchestration
  permission policies
  request/response DTO validation

Domain layer
  pure functions
  value objects
  type guards
  validators
  formula calculations
  map/sheet normalization
  grid/pathfinding/occupancy rules
  move automation rules

Infrastructure layer
  filesystem repositories
  JSON serialization
  SSE/realtime publisher/subscriber adapters
  browser storage/client id adapters
  Three.js renderer internals
```

Keep dependencies pointing inward where practical:

- UI can depend on application and domain.
- Application can depend on domain and infrastructure interfaces.
- Domain should not depend on Vue, Nuxt, H3, Node filesystem, browser globals, Three.js, or route state.
- Infrastructure can depend on concrete libraries such as Node filesystem, H3, browser APIs, or Three.js.

## Refactoring principles to enforce

### SOLID

#### Single Responsibility Principle

Each file/module/function should have one reason to change.

Examples of current targets:

- API route files should only parse requests, enforce route-level auth, call a use case/service, and return the response. They should not contain directory walking, JSON parsing, slug allocation, data normalization, realtime message construction, and permission logic all inline.
- `server/utils/mapStorage.ts` should not be both a filesystem repository, map document validator/normalizer, path sanitizer, slug allocator, summary builder, and folder listing service unless intentionally split into focused submodules.
- `pages/maps/[slug].vue` should not contain map loading, permission logic, initiative logic, token mutation, sheet mutation, field effect logic, terrain builder state, move automation, route navigation, and UI markup all in one page.
- `components/IsometricGrid.client.vue` should not own texture generation, Three.js scene lifecycle, token rendering, voxel rendering, hazard rendering, field-effect rendering, interaction/picking/dragging, HP/combat UI popovers, and material caching in one component.
- `data/characterSheets.ts` and `data/trainerSheets.ts` should not mix static data loading, sheet lookup maps, stat formulas, skill formulas, capability resolution, and other derivation logic if those responsibilities can be separated cleanly.

#### Open/Closed Principle

Design extension points so adding new map document operations, sheet kinds, map effect kinds, renderer object types, or route endpoints does not require modifying many unrelated files.

Examples:

- Use a `SheetKindConfig` map for Pokémon vs trainer filesystem roots, display labels, default sheet factories, and permission behavior instead of repeated `kind === 'pokemon' ? ... : ...` branches everywhere.
- Define storage repositories and use cases that can support new document collections later.
- Keep map field effect definitions data-driven where possible.
- Keep renderer subsystems pluggable enough that adding new overlays/hazards/lights does not require editing a monolithic rendering component.

#### Liskov Substitution Principle

Where interfaces are introduced, concrete implementations must respect the contract.

Examples:

- If you define a `JsonDocumentRepository<T>`, all implementations should consistently return normalized domain objects, throw typed domain/application errors, and preserve write formatting.
- If you define an `EventPublisher`, both in-process realtime and any future publisher should accept the same event payload shape without hidden side effects.

#### Interface Segregation Principle

Consumers should not depend on fat interfaces.

Examples:

- A map save route does not need every storage method; it needs find/read/write for maps.
- A sheet list page does not need sheet mutation methods.
- Renderer submodules should receive narrowly scoped dependencies, not the entire Vue component state.

#### Dependency Inversion Principle

High-level application logic should depend on interfaces or injected dependencies where it improves testability.

Examples:

- Pure use cases should not directly call `readFileSync`, `writeFileSync`, or `publishRealtime` if that makes them hard to test. Inject repositories/publishers or keep filesystem code in a dedicated infrastructure boundary.
- Map/sheet permissions should be functions or services that can be unit-tested without H3 events.

### DRY

Eliminate repeated logic when the abstraction is real and clarifies the code. Do not create vague helpers just to reduce line count.

Specific duplication targets to audit:

- Auth role constants/type guards duplicated between `server/utils/auth.ts` and `composables/useAuth.ts`.
- Realtime event interfaces duplicated between server and client realtime utilities.
- `deepClone` and `stableJson` duplicated in editable map/sheet composables.
- Folder path sanitization repeated across map and sheet endpoints.
- Slug validation and slug allocation repeated across map and sheet code.
- Recursive file walking repeated in sheet endpoints and map save logic.
- `findFile` and `findFileBySlug` repeated in sheet save, sheet move, and map save helper code.
- `folder` field stripping before persistence repeated in multiple places.
- Production-disable checks repeated in dev-only endpoints.
- H3 `createError` validation patterns repeated in every route.
- Realtime publish patterns repeated for maps/sheets.
- Pokémon/trainer branch logic repeated in map token HP, combat stage, and condition mutation code.
- Large page templates repeating panel/card/header/list patterns.
- Three.js texture/material creation/disposal patterns repeated or hidden in one huge component.

### Law of Demeter

Reduce long chains of object knowledge and leaking internal structure across modules.

Examples:

- UI code should not need to know exactly where `pokemon.combat.currentHp` vs `trainer.currentHp` lives. Provide functions such as `getSheetHpSnapshot`, `withSheetHp`, or `applySheetHpUpdate`.
- UI code should not need to know that map `folder` is derived from disk path and removed before persistence. Storage code should encapsulate this.
- Route handlers should not need to know path traversal rules, root directories, slug matching fallback rules, and JSON rewrite details.
- Map editor UI should work with a `MapEditorModel` or focused composables rather than directly drilling through `map.value.placements`, `pokemonBySlug.value`, `trainerBySlug.value`, route params, auth state, and realtime side effects everywhere.

## High-value refactor targets

### 1. Shared auth module

Current problem to verify:

- `server/utils/auth.ts` defines `AUTH_ROLE_COOKIE`, `AuthRole`, and role parsing.
- `composables/useAuth.ts` also defines auth role constants and type guards.

Target:

- Create one shared module safe for both client and server, such as `shared/auth.ts` or `utils/authShared.ts`.
- Export:

```ts
export const AUTH_ROLE_COOKIE = 'rotom-role'
export const AUTH_ROLES = ['gm', 'player'] as const
export type AuthRole = (typeof AUTH_ROLES)[number]
export const isAuthRole = (value: unknown): value is AuthRole => ...
export const authRoleLabel = (role: AuthRole | null): 'GM' | 'Player' | 'Guest' => ...
```

- Update `server/utils/auth.ts` to import shared constants/type guard and remain the H3-specific adapter with `getCookie`, `requireAuthRole`, and `requireGm`.
- Update `composables/useAuth.ts` to import the shared constants/type guard and focus only on Vue cookie state.
- Add tests for `isAuthRole` and role labels.

### 2. Shared realtime event types

Current problem to verify:

- Server and client define similar `RealtimeEvent` interfaces.

Target:

- Create `types/realtime.ts` or `shared/realtime.ts`.
- Export a common `RealtimeEvent<TData = unknown>` type, channel name helpers, and common event type constants if useful.
- Keep `server/utils/realtime.ts` as the server in-process publisher/subscriber implementation.
- Keep `composables/useRealtime.ts` as the browser SSE subscriber/multiplexer.
- Avoid server/client circular imports.
- Preserve clientId echo suppression semantics in `useEditableMap`, `useEditableSheet`, and live sheets.

### 3. Serialization helpers

Current problem to verify:

- `deepClone` and `stableJson` exist in more than one composable with slightly different behavior.

Target:

- Add a shared JSON utility module, for example `utils/json.ts` or `utils/serialization.ts`:

```ts
export const deepCloneJson = <T>(value: T): T => ...
export const stableJsonStringify = (value: unknown): string => ...
export const sameJsonValue = (a: unknown, b: unknown): boolean => ...
export const omitUndefinedJsonFields = <T extends Record<string, unknown>>(value: T): Partial<T> => ...
```

- Use stable key ordering where semantic equality matters.
- Keep JSON-only assumptions explicit; do not pretend this preserves class instances, Dates, Maps, Sets, functions, or circular references.
- Replace local duplicates in `useEditableMap` and `useEditableSheet`.
- Add tests for key-order stability and undefined omission.

### 4. Filesystem path and JSON repository utilities

Current problem to verify:

- Recursive directory walking, root path resolution, folder sanitization, path traversal checks, JSON parsing/writing, and empty parent pruning are scattered across endpoints and `mapStorage`.

Target modules:

```text
server/utils/fsPaths.ts
server/utils/jsonFiles.ts
server/utils/documentStorage.ts
```

Suggested responsibilities:

#### `server/utils/fsPaths.ts`

- `PROJECT_ROOT`
- `relativeToProjectRoot(absPath: string): string`
- `ensureInsideRoot(root: string, target: string): void`
- `sanitizeFolderPath(path: string, options?: { allowEmpty?: boolean }): string`
- `joinSafeUnderRoot(root: string, folder: string, fileName?: string): string`
- `pruneEmptyParents(path: string, root: string): void`

#### `server/utils/jsonFiles.ts`

- `readJsonFile<T>(path: string): T`
- `writeJsonFile(path: string, value: unknown): void`
- `tryReadJsonFile<T>(path: string): T | null`
- `walkFiles(root: string, predicate?: (entry) => boolean): string[]` or an iterator/generator
- `findFileByName(root: string, fileName: string): string | null`
- `findJsonFileByField(root: string, field: string, expected: unknown): string | null`

#### `server/utils/documentStorage.ts`

- Reusable interfaces and small helpers for filesystem-backed JSON documents.
- Avoid a bloated “god storage” abstraction. Keep interfaces small.

Acceptance criteria:

- Route handlers no longer directly implement recursive filesystem walking.
- Folder validation behavior remains the same or stricter in safe ways.
- Path traversal is explicitly defended.
- JSON writes keep the existing `JSON.stringify(value, null, 2) + '\n'` style.
- Existing data file formats remain compatible.

### 5. Sheet storage module

Current problem to verify:

- Map storage has `server/utils/mapStorage.ts` but sheet persistence logic is scattered through sheet API files and duplicated from map code.

Target:

Create `server/utils/sheetStorage.ts` or split modules under `server/storage/sheets/`.

Suggested exports:

```ts
export type SheetKind = 'pokemon' | 'trainer'

export interface SheetKindConfig {
  kind: SheetKind
  root: string
  defaultBaseSlug: string
  displayName: string
}

export const SHEET_KIND_CONFIG: Record<SheetKind, SheetKindConfig>
export const isSheetKind(value: unknown): value is SheetKind
export const sheetRootFor(kind: SheetKind): string
export const validateSheetSlug(slug: string): string
export const findSheetFile(kind: SheetKind, slug: string): string | null
export const findSheetFileBySlug(kind: SheetKind, slug: string): string | null
export const readSheetFile<T extends Record<string, unknown>>(kind: SheetKind, slug: string): { path: string; sheet: T }
export const writeSheetFile(path: string, sheet: Record<string, unknown>): void
export const stripDerivedSheetFields(sheet: Record<string, unknown>): Record<string, unknown>
export const allocateSheetSlug(kind: SheetKind): string
export const moveSheetFile(kind: SheetKind, slug: string, folder: string): MoveResult
export const renameSheetFile(...): RenameResult
export const deleteSheetFile(...): DeleteResult
export const listSheetFolders(kind?: SheetKind): string[]
```

Important behavior to preserve:

- Pokémon sheets live under `data/sheets`.
- Trainer sheets live under `data/trainers`.
- Subfolders are valid and become folder labels.
- `folder` is derived from path and should not be persisted unless current code intentionally preserves it somewhere. Current convention appears to strip `folder` before persistence.
- `save` should find by `${slug}.json` first, then fall back to scanning JSON files for a top-level `slug` field because some generated files may use snake_case filenames with kebab-case slugs.
- Player role can only save player-accessible sheets.
- GM-only operations remain GM-only.
- Existing production-disable behavior for local dev write tools should remain unless deliberately documented.

### 6. Map storage split and cleanup

Current problem to verify:

- `server/utils/mapStorage.ts` contains useful logic but mixes many responsibilities.

Target:

Split where beneficial, for example:

```text
server/storage/maps/mapPaths.ts
server/storage/maps/mapRepository.ts
server/storage/maps/mapNormalization.ts
server/storage/maps/mapSummaries.ts
```

or keep files under `server/utils/` if the project prefers that style, but responsibilities should be clear.

Suggested boundaries:

- Path/root/folder helpers shared with sheets should move to generic fs modules.
- Map document normalization should be pure and testable.
- Map repository should handle find/read/write/list/move/delete/rename.
- Summary building should be pure.
- Route handlers should call use cases/repository methods, not implement storage details inline.

Important behavior to preserve:

- Maps live under `data/maps` recursively.
- Map documents are schemaVersion `2`.
- `folder` is derived from file path on read and not persisted on write.
- `groundLevelY` is clamped relative to dimensions.
- Voxels/hazards/field effects are normalized using existing utilities.
- Summaries include slug, name, folder, dimensions, placementCount, playerVisible, schemaVersion, and updatedAt.
- Folder listing and sorting should stay stable.

### 7. Thin API route handlers

Current problem to verify:

- API files contain validation, auth, filesystem operations, domain normalization, realtime publishing, and response formatting inline.

Target:

Introduce use-case/service functions and keep route handlers thin.

A route handler should look closer to:

```ts
export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireNonProductionIfNeeded()
  const body = await readValidatedBody(event, createSheetRequestSchemaOrGuard)
  return createSheetUseCase({ body, role, publisher: realtimePublisher, repository: sheetRepository })
})
```

You do not need to adopt a schema library if adding one is too much. Type guards plus focused validators are acceptable.

Refactor these endpoint groups first:

```text
server/api/sheets/create.post.ts
server/api/sheets/save.post.ts
server/api/sheets/move.post.ts
server/api/sheets/rename.post.ts
server/api/sheets/delete.post.ts
server/api/sheets/create-folder.post.ts
server/api/sheets/move-folder.post.ts
server/api/sheets/delete-folder.post.ts
server/api/sheets/folders.get.ts

server/api/maps/create.post.ts
server/api/maps/save.post.ts
server/api/maps/move.post.ts
server/api/maps/rename.post.ts
server/api/maps/delete.post.ts
server/api/maps/create-folder.post.ts
server/api/maps/move-folder.post.ts
server/api/maps/delete-folder.post.ts
server/api/maps/folders.get.ts
server/api/maps/list.get.ts
server/api/maps/load.get.ts
```

Also audit:

```text
server/api/events.get.ts
server/api/encounters/generate.post.ts
```

Acceptance criteria:

- Auth behavior preserved.
- HTTP status codes and status messages stay compatible unless an improvement is deliberate and documented.
- Realtime channels and payload shapes stay compatible.
- Response shapes stay compatible.
- Existing dev-only production guards stay compatible.
- Endpoint files become short adapters, ideally under 80–120 lines each unless there is a clear reason.

### 8. Shared HTTP/request validation helpers

Target:

Create focused helpers, for example:

```ts
server/utils/http.ts
```

Potential exports:

```ts
export const badRequest = (statusMessage: string): never => ...
export const notFound = (statusMessage: string): never => ...
export const conflict = (statusMessage: string): never => ...
export const forbidden = (statusMessage: string): never => ...
export const requireNonProduction = (): void => ...
export const readObjectBody = async <T>(event: H3Event): Promise<T> => ...
export const expectString = (...): string
export const expectSlug = (...): string
```

Keep it small. Do not create a framework inside the app.

### 9. Client autosave composable extraction

Current problem to verify:

- `useEditableMap` and `useEditableSheet` both implement a deep reactive copy, server snapshot tracking, debounced saves, stale save sequence handling, and realtime echo suppression.
- They have legitimate differences: map loads from server by slug and patches a stable object; sheet starts from static glob data, supports unload beacon/keepalive saves, and uses kind-specific channels.

Target:

Extract common mechanisms without erasing the meaningful differences.

Possible modules:

```text
composables/useDebouncedAutosave.ts
composables/useRealtimeBackedResource.ts
utils/autosave.ts
```

Common concepts:

- `SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'not-found'` or scoped variants.
- `cancelPendingSave`
- `saveNow`
- `lastServerJson`
- `saveSeq`
- stable JSON comparison
- error normalization
- debounced watcher
- optional `beforeunload`/`pagehide` flushing

Acceptance criteria:

- `useEditableMap` and `useEditableSheet` get shorter and easier to read.
- Existing semantics are preserved:
  - map edits save to `/api/maps/save`
  - sheet edits save to `/api/sheets/save`
  - clientId echo suppression remains
  - map rename handling remains
  - sheet unload flush remains
  - save status behavior remains compatible with `SaveIndicator`

### 10. Sheet mutation abstraction

Current problem to verify:

In `pages/maps/[slug].vue`, operations such as modifying HP, combat stages, and conditions branch repeatedly on `placement.sheetKind` and directly mutate Pokémon vs trainer sheet structures.

Target:

Create a domain/application utility that hides Pokémon/trainer internal differences.

Possible module:

```text
utils/sheetMutations.ts
```

Potential functions:

```ts
export type AnyLiveSheet = CharacterSheet | TrainerSheet
export type SheetLookupMaps = {
  pokemon: Map<string, CharacterSheet>
  trainer: Map<string, TrainerSheet>
}

export const getSheetForPlacement = (...): CharacterSheet | TrainerSheet | null
export const cloneSheetForUpdate = (...): CharacterSheet | TrainerSheet
export const getHpSnapshotForSheet = (...): { currentHp: number; maxHp: number }
export const applyHpToSheet = (...): CharacterSheet | TrainerSheet
export const applyCombatStagesToSheet = (...): CharacterSheet | TrainerSheet
export const applyConditionsToSheet = (...): CharacterSheet | TrainerSheet
export const toPersistableSheetPayload = (...): Record<string, unknown>
```

Then create a map-page/application helper such as:

```ts
async function updatePlacedSheet(
  placement: SheetPlacement,
  lookups: SheetLookupMaps,
  update: (sheet: AnyLiveSheet) => AnyLiveSheet,
  saveSheet: SaveSheetFn,
): Promise<void>
```

Acceptance criteria:

- Map page no longer needs to know exact nested Pokémon vs trainer storage for HP/conditions/combat stages.
- Player/GM permission checks remain outside or clearly integrated.
- Rollback-on-save-failure behavior remains.
- Sheet save API payloads stay compatible.

### 11. Map editor page decomposition

Current problem to verify:

- `pages/maps/[slug].vue` is a large “god page”. It appears to contain auth, routing, page state, map visibility, sidebars, terrain builder, hazard builder, field effects, token spawning, token movement, sheet HP/condition/stage mutations, initiative tracker, move automation, and large template sections.

Target:

Extract focused composables and components.

Suggested composables:

```text
composables/map-editor/useMapAccess.ts
composables/map-editor/useMapEditorState.ts
composables/map-editor/useTokenControls.ts
composables/map-editor/useTokenSheetMutations.ts
composables/map-editor/useInitiativeTracker.ts
composables/map-editor/useTerrainBuilder.ts
composables/map-editor/useHazardBuilder.ts
composables/map-editor/useFieldEffectsEditor.ts
composables/map-editor/useMoveAutomationPanel.ts
```

Suggested components:

```text
components/map/MapPageHeader.vue
components/map/MapVisibilityGate.vue
components/map/MapLeftSidebar.vue
components/map/MapDetailsPanel.vue
components/map/TerrainBuilderPanel.vue
components/map/HazardBuilderPanel.vue
components/map/FieldEffectsPanel.vue
components/map/InitiativeTracker.vue
components/map/TokenActionPanel.vue
components/map/MapAdminPanel.vue
components/map/LayerVisibilityControls.vue
```

Do not over-split into tiny one-off components. Split along stable responsibilities.

Acceptance criteria:

- `pages/maps/[slug].vue` becomes a route composition shell.
- Route file still clearly shows page flow: load map, set head, handle rename redirect, render grid/sidebar/panels.
- Business logic becomes testable or at least isolated in composables/utilities.
- Components receive minimal props and emit explicit events.
- No component needs to reach through unrelated structures more than necessary.
- UI behavior is unchanged.

### 12. Three.js / isometric renderer decomposition

Current problem to verify:

- `components/IsometricGrid.client.vue` is very large and appears to mix Three.js lifecycle, texture generation, material caching, token rendering, terrain voxel rendering, hazard rendering, field effects, browser event handling, picking/dragging, UI popovers, and emitted game actions.

Target:

Keep the Vue component as a shell/adapter and move renderer internals to focused modules.

Suggested structure:

```text
components/IsometricGrid.client.vue                 # thin Vue adapter
utils/isometric/types.ts                            # renderer-specific types
utils/isometric/scene.ts                            # scene/camera/renderers/controls setup
utils/isometric/lifecycle.ts                        # animation loop, resize handling, disposal coordination
utils/isometric/materials.ts                        # Three material helpers
utils/isometric/blockTextures.ts                    # generated block texture factory/cache
utils/isometric/voxelRenderer.ts                    # voxel instancing/update/disposal
utils/isometric/tokenRenderer.ts                    # Pokémon/trainer sprite objects/update/disposal
utils/isometric/hazardRenderer.ts                   # hazard overlays
utils/isometric/fieldEffectRenderer.ts              # weather/terrain/room visuals
utils/isometric/gridRenderer.ts                     # grid/cell overlays
utils/isometric/interactions.ts                     # raycasting/picking/dragging/build/hazard interactions
utils/isometric/cssSprites.ts                       # HP bars/elevation badges/CSS3D sprites
utils/isometric/resourceDisposal.ts                 # dispose geometries/materials/textures safely
```

Alternative directory names are fine, but responsibilities must be clear.

Important constraints:

- Preserve all current events emitted by `IsometricGrid.client.vue`.
- Preserve props as much as possible or provide a backwards-compatible migration.
- Avoid changing visual behavior except to fix clear bugs.
- Make cleanup/disposal explicit to avoid memory leaks.
- Keep Three.js-specific code out of domain utilities.
- Keep generated texture caching deterministic.
- Do not import Vue refs/reactivity into low-level renderer modules unless there is a strong reason. Prefer plain state objects and explicit update methods.

Acceptance criteria:

- The Vue component becomes substantially smaller and easier to scan.
- Each renderer subsystem has clear create/update/dispose lifecycle.
- Resource disposal is centralized enough that it is hard to forget.
- Interaction code is isolated from rendering code where practical.
- TypeScript types make renderer contracts explicit.

### 13. Sheet editor page decomposition

Current problem to verify:

- `pages/sheets/[slug].vue` is a large Pokémon sheet editor that combines route lookup, normalization, autosave, computed derivations, editing helper functions, and a large template.
- `pages/sheets/trainers/[slug].vue` likely has similar responsibilities for trainers.

Target:

Extract domain derivations, editor state, and UI panels.

Suggested composables:

```text
composables/sheets/usePokemonSheetEditor.ts
composables/sheets/useTrainerSheetEditor.ts
composables/sheets/useSheetAccess.ts
composables/sheets/useSheetLookupRows.ts
```

Suggested components:

```text
components/sheets/PokemonSheetEditor.vue
components/sheets/TrainerSheetEditor.vue
components/sheets/SheetIdentityPanel.vue
components/sheets/PokemonStatsPanel.vue
components/sheets/TrainerStatsPanel.vue
components/sheets/CombatPanel.vue
components/sheets/EvasionPanel.vue
components/sheets/CapabilitiesPanel.vue
components/sheets/SkillsPanel.vue
components/sheets/MovesPanel.vue
components/sheets/AbilitiesPanel.vue
components/sheets/ItemsPanel.vue
components/sheets/EdgesFeaturesPanel.vue
components/sheets/NotesPanel.vue
```

Also split data derivation modules:

```text
utils/sheets/pokemonStats.ts
utils/sheets/trainerStats.ts
utils/sheets/skills.ts
utils/sheets/capabilities.ts
utils/sheets/evasion.ts
```

Only split where it improves clarity.

Acceptance criteria:

- Route pages become shells that resolve slug/access, set metadata, and render editor components.
- Formula/derivation logic lives in pure utility modules with tests.
- Editor components have small, explicit props/events or use focused composables.
- Existing editable cell behavior and autosave behavior are preserved.

### 14. Data loader vs resolver separation

Current problem to verify:

- `data/characterSheets.ts` and `data/trainerSheets.ts` load static JSON modules and also export formula/derivation functions.

Target:

Consider separating:

```text
 data/characterSheets.ts              # static glob loading and lookup maps only
 data/trainerSheets.ts                # static glob loading and lookup maps only
 utils/sheets/pokemonDerived.ts        # resolveStats, resolveSkills, resolveCapabilities, validateBaseRelations
 utils/sheets/trainerDerived.ts        # resolveTrainerStats, resolveTrainerSkills, resolveTrainerCapabilities, advancement
```

or use a similar structure.

Acceptance criteria:

- Static data loading remains compatible with Vite/Nuxt `import.meta.glob`.
- Existing imports are updated safely.
- Derived functions are pure and testable.
- No accidental server-only imports are introduced into client bundles.

### 15. Domain constants and value objects

Audit magic strings and regexes:

- `SLUG_RE`
- `SAFE_SEGMENT`
- `AUTH_ROLE_COOKIE`
- sheet kinds
- map channels and sheet channels
- `BuildTool`
- map material IDs
- event types such as `updated`, `deleted`, `renamed`, `moved`, `created`
- save statuses
- combat stage keys

Target:

- Put stable domain constants/types in shared modules.
- Avoid duplicating regexes.
- Use helper functions for channel naming, for example:

```ts
export const mapChannel = (slug: string) => `map:${slug}` as const
export const sheetChannel = (kind: SheetKind, slug: string) => `sheet:${kind}:${slug}` as const
export const mapsChannel = 'maps'
export const sheetsChannel = 'sheets'
```

Acceptance criteria:

- No duplicate role constants.
- No duplicate realtime event interface.
- Slug/folder validation is centralized.
- Channel naming is centralized.

### 16. Permissions and policy extraction

Current problem to verify:

- Auth requirements and player-vs-GM permissions are partly embedded in route files and map save logic.

Target:

Create small policy functions, for example:

```text
server/policies/sheetPolicy.ts
server/policies/mapPolicy.ts
```

Potential functions:

```ts
export const canSaveSheet = (role: AuthRole, existingSheet: SheetRecord): boolean => ...
export const canSaveMap = (role: AuthRole, existingMap: TabletopMap): boolean => ...
export const applyPlayerMapSavePolicy = (existing: TabletopMap, incoming: TabletopMap, sheetAccess: SheetAccess): TabletopMap => ...
```

Important behavior to preserve:

- Unauthenticated users cannot call protected mutation endpoints.
- GM can do GM-only operations.
- Player can only save sheets marked player-accessible.
- Player map saves only apply allowed placement edits and cannot mutate terrain, hazards, map metadata, or other GM-only state.
- Player cannot save non-visible maps.

Acceptance criteria:

- Permission behavior is unit-testable without spinning up H3.
- Route handlers call policy/use-case code rather than inline all checks.
- Security is at least as strict as before.

### 17. Move automation and encounter generation audit

Audit `server/api/encounters/generate.post.ts`, `pages/generate.vue`, `components/MoveAutomationDialog.vue`, `utils/moveAutomation*`, and `scripts/check_move_automation_coverage.py`.

Targets:

- Keep move automation rule logic pure and tested where possible.
- Ensure generated sheets/maps still use compatible slugs and filenames.
- Ensure refactors of sheet storage preserve any filename-vs-slug mismatch handling used by generated content.
- Keep existing `check:move-automation` script working.

### 18. Tests and quality gates

The current `package.json` may not have lint/typecheck/test scripts. Add minimal quality gates if missing.

Preferred:

```json
{
  "scripts": {
    "typecheck": "nuxt typecheck",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "latest compatible version"
  }
}
```

Only add dependencies that are justified and lightweight. If `nuxt typecheck` requires additional packages, add the appropriate Nuxt/Vue typecheck dependency and document it.

Add tests first around pure logic and storage helpers. Good initial tests:

- Auth role guard accepts `gm`/`player` and rejects everything else.
- Folder sanitizer accepts nested safe folders and rejects `..`, slashes in segments, blank segments, path traversal, spaces if current behavior rejects spaces, and unsafe characters.
- `relativeToProjectRoot` and `ensureInsideRoot` behave correctly.
- JSON stable stringifier sorts object keys and omits/handles undefined consistently with chosen behavior.
- Sheet storage can find a file by filename and fallback by top-level slug.
- Sheet storage strips derived `folder` before persistence.
- Map normalization validates schema version, slug, dimensions, voxels, hazards, field effects, and ground level.
- Map write/read preserves folder derivation behavior.
- Player map save policy only merges allowed placement position/turned changes.
- `grid.ts` placement/pathing functions work for simple occupancy cases.
- HP formula and clamp utilities preserve expected values.
- Status condition normalization preserves allowed names.
- Combat stage clamp stays within expected bounds.

Do not attempt to unit-test massive Vue templates first. Prioritize pure logic extraction and tests.

Quality gate after each meaningful phase:

```bash
npm install
npm run build
npm run check:move-automation
npm run sync:item-sprites -- --dry-run  # only if this script supports dry-run; otherwise do not run it blindly
npm run typecheck                       # if added
npm test                                # if added
```

If a command fails before your changes, record the baseline failure. If it fails after your changes, fix your changes or clearly isolate the pre-existing issue.

## Concrete staged plan

Work in phases. After each phase, commit or at least keep changes small enough to review. Do not do one giant rewrite.

### Phase 0 — Baseline audit

1. Inspect current repo structure.
2. Confirm current package scripts and dependency versions.
3. Confirm whether tests/lint/typecheck exist.
4. Run the existing build/check commands that are reasonable for the Pi environment.
5. Record baseline failures in a short `REFACTOR_NOTES.md` or PR summary, not in source comments.
6. Identify the largest files and largest duplication clusters.
7. Confirm `rotom_table_old` was ignored.

Deliverable:

- A short audit note with baseline commands/results and a prioritized refactor checklist.

### Phase 1 — Shared foundations

Implement the smallest low-risk shared modules:

- Shared auth constants/type guard.
- Shared realtime event/channel types/helpers.
- Shared JSON serialization helpers.
- Shared slug/folder/path validation helpers where possible.
- Minimal tests for these helpers.

Acceptance:

- No behavior changes.
- Build/typecheck/test pass or baseline failures are unchanged.

### Phase 2 — Filesystem storage consolidation

Implement generic filesystem helpers and sheet storage module.

Refactor sheet endpoints to use the new storage functions.

Acceptance:

- Sheet endpoints are thin.
- Existing sheet create/save/move/rename/delete/folder behavior is preserved.
- Tests cover critical storage behavior.

### Phase 3 — Map storage/use-case cleanup

Split or clarify map storage responsibilities.

Refactor map endpoints to use map repository/use-case functions.

Acceptance:

- Map endpoints are thin.
- Map list/load/save/create/move/rename/delete/folder behavior is preserved.
- Player save policy is tested.
- Realtime events remain compatible.

### Phase 4 — Client autosave/realtime cleanup

Extract shared autosave/realtime resource helpers.

Refactor `useEditableMap`, `useEditableSheet`, and `useLiveSheets` to use shared types and helpers.

Acceptance:

- Save behavior, status behavior, debounce behavior, unload flush behavior, and echo suppression remain compatible.
- Composables are shorter and focused.

### Phase 5 — Map editor logic extraction

Extract pure sheet mutation helpers and map editor composables.

Then split the map page into route shell plus panels/components.

Suggested order:

1. Extract `utils/sheetMutations.ts` and update HP/stage/condition code.
2. Extract initiative tracker logic to a composable and/or component.
3. Extract terrain/hazard/field effects panels.
4. Extract token controls and sheet browser integration.
5. Reduce `pages/maps/[slug].vue` to a route composition shell.

Acceptance:

- UI behavior unchanged.
- Route page becomes significantly smaller.
- Repeated Pokémon/trainer branches are removed or isolated.
- Logic is easier to test.

### Phase 6 — Three.js renderer decomposition

Extract rendering subsystems from `IsometricGrid.client.vue` carefully.

Suggested order:

1. Move pure renderer types/constants.
2. Move texture/material helpers.
3. Move voxel renderer.
4. Move token renderer.
5. Move hazard/field-effect renderer.
6. Move interaction/picking/build/hazard target logic.
7. Centralize disposal.
8. Leave the Vue component as a shell that wires props/events/lifecycle.

Acceptance:

- Rendering looks and behaves the same.
- Props/events are preserved.
- Resource disposal is explicit.
- The component is much easier to read.

### Phase 7 — Sheet editor decomposition

Split Pokémon and trainer sheet route pages into route shell, editor composables, and panel components.

Move pure derived logic out of data loader modules if appropriate.

Acceptance:

- Sheet editors behave the same.
- Autosave behavior unchanged.
- Formula/derived functions are testable and covered by tests.
- Route page files are significantly smaller.

### Phase 8 — Cleanup and documentation

1. Remove dead code created by refactor.
2. Normalize imports.
3. Ensure no accidental `rotom_table_old` references.
4. Add/update a concise architecture note if useful, for example `docs/architecture.md` or `REFACTOR_NOTES.md`.
5. Run all quality gates.
6. Provide a final summary listing changed modules, behavior preserved, tests added, and follow-up recommendations.

## Code style guidance

- Prefer TypeScript `type` and `interface` names that describe domain concepts, not implementation details.
- Prefer pure functions for formulas and validation.
- Prefer early returns over deeply nested control flow.
- Prefer explicit narrow types over `Record<string, unknown>` once data is validated.
- Use `unknown` at boundaries, validate, then convert to precise types.
- Keep thrown errors meaningful. At HTTP boundaries, convert domain/application errors to H3 `createError` responses.
- Keep files small enough to understand. As a rough guideline, a utility file over ~300 lines or a Vue SFC over ~500 lines should trigger a split review, but do not split mechanically.
- Avoid barrel files that create circular imports or hide server/client boundaries.
- Avoid default exports for general utilities unless the project already standardizes on them.
- Use Nuxt auto-imports where consistent with the existing app, but be explicit where clarity improves.
- Avoid importing server-only modules into client code.
- Avoid importing browser-only modules into server code.
- Keep `~/types/*` and shared modules safe for both environments.
- Keep CSS class names stable unless changing a component requires a scoped rename.
- Preserve accessibility semantics where present.

## Specific acceptance criteria

The refactor is successful when:

1. The app builds successfully with `npm run build`, or build failures are proven pre-existing and documented.
2. Existing scripts still work, especially `npm run check:move-automation`.
3. Newly added tests pass.
4. No code imports from or references `rotom_table_old`.
5. Existing routes remain available:
   - `/`
   - `/login`
   - `/maps`
   - `/maps/[slug]`
   - `/sheets`
   - `/sheets/[slug]`
   - `/sheets/trainers/[slug]`
   - `/pokedex` and `/pokedex/[[pokemon_name]]`
   - reference pages for rules/items/moves/abilities/capabilities/features/edges/conditions/grids as currently implemented
6. Existing API endpoint response shapes remain compatible.
7. Existing JSON document formats remain compatible:
   - `data/maps/**/*.json`
   - `data/sheets/**/*.json`
   - `data/trainers/**/*.json`
8. Existing realtime channels remain compatible:
   - `map:<slug>`
   - `maps`
   - `sheet:<kind>:<slug>`
   - `sheets`
9. Existing clientId echo suppression remains.
10. Existing auth semantics remain or become stricter only where clearly correct:
    - unauthenticated mutation requests rejected
    - GM-only actions remain GM-only
    - player sheet saves require player-accessible sheets
    - player map saves cannot mutate GM-only map state
11. `folder` remains derived from path where existing code expects that.
12. Slug and folder validation defends against path traversal.
13. Large components/pages are reduced by extracting cohesive modules.
14. Domain logic is more testable and less coupled to Vue/Nuxt/Three/H3/filesystem.
15. The final summary explains what was refactored, how behavior was preserved, and what remains for a future pass.

## Anti-goals

Do not:

- Rewrite the entire app in another framework.
- Replace filesystem-backed JSON storage with a database unless explicitly asked later.
- Change Nuxt major version just for refactoring.
- Add a large state-management library unless there is a clear, narrow reason.
- Add a schema validation library unless you use it consistently and it meaningfully reduces errors.
- Change visual design during refactor.
- Rename public routes.
- Rename existing data files unnecessarily.
- Change static PTU data semantics.
- Collapse all code into generic abstractions that hide intent.
- Create a single mega-service that becomes the new god object.
- Make broad formatting-only changes across unrelated files in the same commit as logic changes.

## Suggested implementation patterns

### Thin route pattern

Prefer:

```ts
export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireNonProduction()
  const body = await readCreateSheetBody(event)
  return createSheet({ body, role, sheetRepository, realtimePublisher })
})
```

Avoid:

```ts
export default defineEventHandler(async (event) => {
  // 200 lines of validation, path traversal handling, recursive walking,
  // JSON parsing, auth branching, realtime event construction, and response shaping.
})
```

### Repository/use-case pattern without over-engineering

Good:

```ts
export interface SheetRepository {
  findBySlug(kind: SheetKind, slug: string): Promise<SheetDocument | null> | SheetDocument | null
  write(path: string, sheet: PersistedSheet): Promise<void> | void
  move(kind: SheetKind, slug: string, folder: string): Promise<MoveResult> | MoveResult
}
```

Also acceptable for this app:

```ts
export const sheetRepository = {
  findBySlug,
  writeSheet,
  moveSheet,
}
```

Do not introduce complex dependency injection containers.

### Domain error pattern

Define small typed errors if useful:

```ts
export class DomainError extends Error {
  constructor(
    public readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
  }
}
```

Then map to H3 errors at route boundaries.

Do not throw raw strings.

### Sheet kind config pattern

Prefer:

```ts
const SHEET_KIND_CONFIG = {
  pokemon: { root: resolve(PROJECT_ROOT, 'data/sheets'), defaultSlug: 'new-pokemon' },
  trainer: { root: resolve(PROJECT_ROOT, 'data/trainers'), defaultSlug: 'new-trainer' },
} as const
```

Avoid repeated branches such as:

```ts
kind === 'pokemon' ? 'data/sheets' : 'data/trainers'
kind === 'pokemon' ? 'new-pokemon' : 'new-trainer'
kind === 'pokemon' ? pokemonBySlug : trainerBySlug
```

Branching is fine at a single boundary; duplication across many modules is not.

### Vue page shell pattern

A route page should read like:

```vue
<script setup lang="ts">
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const editor = useMapEditorPage(slug)
useHead(editor.head)
</script>

<template>
  <MapEditorPage v-bind="editor.props" @...="..." />
</template>
```

It does not have to be exactly this, but the route should not be a god component.

### Renderer subsystem pattern

Low-level renderer modules should expose lifecycle functions:

```ts
export interface RendererSubsystem<TInput> {
  update(input: TInput): void
  dispose(): void
}
```

or focused equivalents. Make ownership of geometries/materials/textures explicit.

## Suggested final report format

When done, report:

```markdown
## Refactor summary

- Ignored `rotom_table_old` entirely.
- Changed:
  - ...
- Added tests:
  - ...
- Behavior preserved:
  - ...
- Commands run:
  - `npm run build` — pass/fail with notes
  - `npm test` — pass/fail with notes
  - `npm run check:move-automation` — pass/fail with notes
- Follow-up recommendations:
  - ...
```

## Start now

Begin with Phase 0. Use the current repository as the source of truth, ignore `rotom_table_old`, and refactor incrementally. Prioritize correctness, behavior preservation, and clean boundaries over speed.
