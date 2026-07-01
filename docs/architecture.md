# Architecture

This is a high-level overview intended for reviewers. It avoids implementation detail and focuses on the product shape.

## Nuxt/Vue app

Rotom Table is a Nuxt 3 application with the app source under `src/`.

- `src/pages/` defines the browser routes for maps, sheets, Pokédex, encounter tools, login, and reference pages.
- `src/components/` contains reusable Vue components for dense product UI: library grids, editors, map controls, sheet rows, encounter panels, and reference cards.
- `src/composables/` coordinates feature state, API calls, autosave flows, and page-level behaviours.
- `src/utils/` contains pure domain helpers, route helpers, persistence clients, reference indexes, map/sheet utilities, and automation logic.
- `src/types/` captures the map, sheet, trainer, shop, encounter, Pokémon, and app-owned PTU reference models used across the app.

## Nitro/server routes

The `server/` directory holds Nitro API routes and server-side application logic.

- `server/api/` exposes endpoints for maps, sheets, shops, player profiles, encounters, Pokédex data, trainer sprites, and realtime events.
- `server/useCases/` keeps core behaviours separate from HTTP route handlers.
- `server/utils/` contains filesystem paths, JSON read/write helpers, storage adapters, policies, and runtime wrappers.

This structure keeps route handlers thin and makes persistence-heavy behaviours easier to test.

## Campaign data roots and maintenance JSON

Runtime maps and Pokémon/trainer sheets are stored in SQLite. `ROTOM_CAMPAIGN_ROOT` still points campaign-owned paths, remaining JSON systems, and the default SQLite database at a private campaign repository or private host directory.

- Runtime maps, map folders, Pokémon sheets, trainer sheets, sheet folders, shared group inventory, and reusable shop tables live in `rotom-table.sqlite` (or `ROTOM_DB_PATH`).
- Persistent player profiles live under `data/player-profiles/`.
- Encounter tables live under `encounter_tables/`.
- Campaign reference override diffs, currently Pokédex maintenance entries, live under `data/reference-overrides/`.
- App-owned PTU reference content lives under `data/reference/` with indexes in `data/ptuReference.ts` and `src/utils/reference/`. `ptu-data/` is documentary upstream/source material and parser output, not the runtime source of truth.
- `data/maps/`, `data/sheets/`, `data/trainers/`, `data/group-inventories/`, and `data/shops/` are maintenance import/export hierarchies for SQLite-backed campaign documents, not runtime fallback authority.

This keeps private data operator-owned while avoiding a dual JSON/SQLite runtime authority model.

## SQLite persistence foundation

All runtime map and Pokémon/trainer sheet paths use a SQLite document store behind server-only repository interfaces. The implementation uses Node's built-in `node:sqlite` module, so there is no additional native SQLite package. `server/storage/database.ts` resolves `ROTOM_DB_PATH` or defaults to `ROTOM_CAMPAIGN_ROOT/rotom-table.sqlite`, opens the database on first repository access, enables WAL for file-backed databases, and applies deterministic migrations from `server/storage/migrations.ts`.

The repositories keep SQL out of use cases and UI code. Map, sheet, folder, interaction-mode, group inventory, and live-play operation records are stored with explicit revision and timestamp columns while preserving JSON document payloads for setup/edit, imports, exports, and backups. The map repository provides normalized map reads, revision-checked setup saves, create/move/rename/delete, logical folders, sheet-reference retargeting, operation-history barriers, and revision-checked live-play updates. The sheet repository provides sheet reads by kind/slug, revision-checked setup saves, create/move/rename/delete, logical folders, atomic map retargeting on sheet rename/delete, and revision-checked live-play sheet updates. The shop table repository stores reusable campaign shop documents with explicit revisions and timestamps in `shop_tables`; current read routes let GMs list/load all shops while players can list/load only shops that are both player-visible and open. Shop checkout operation history is stored separately in `shop_checkout_ops`, keyed by checkout `opId` and `shop_slug`, so shop-page checkout retries do not depend on a map slug. Accepted shop checkout commits append durable realtime rows for the changed shop document/list summary and any changed group inventory or trainer sheet documents, then publish those sequenced events after commit for echo-aware convergence. See [Shops and live-play checkout](shops.md) for the dedicated shop state, command-boundary, map-interface, idempotency, realtime, and export rules. Group inventory saves and trainer transfer routes append durable realtime events for the shared inventory and affected trainer sheet documents so other open clients can converge after the committing transaction; see [Group inventory workflow](group-inventory.md) for the page-level workflow and deferred live-play command boundary. Live-play commands that change map state, sheet state, or both use SQLite repository updates and operation-result storage; multi-document commands use one SQLite transaction for the map update, sheet update, and accepted operation result. Operation history also supports terminal `abandoned` rejections: abandonment stores a tombstone under the same map write queue and command hash without changing map/sheet documents, so later exact command retries return the stored rejection instead of applying effects.

## Shared helpers

The `shared/` directory contains small helpers used by both app and server code, such as auth role values, path validation, sheet kinds, realtime message shapes, and encounter-table normalization. Keeping these definitions shared reduces drift between browser and server assumptions.

`shared/mapActionEvents.ts` defines the transient map action event contract for map-scoped visual cues such as action splashes, move VFX, move feedback, and Poké Ball UI. The `/api/maps/action-event` route validates the target map, actor placement, selected player-profile token control, event kind, and bounded payload before publishing a `map-action` realtime event on that map's channel. `src/composables/map-editor/useMapActionEventSync.ts` is the client bridge for that channel: it posts local visual events to the route, ignores local realtime echoes and duplicate event ids, and rebases received move VFX timestamps onto the receiving tab's animation clock before invoking visual replay handlers. The map page routes action splash banners for moves, abilities, maneuvers, orders, send-outs, Poké Ball throws, and listed reaction prompts through this bridge; it also publishes planned move VFX batches after local enqueue and broadcasts move roll feedback snapshots when the local feedback sequence starts. Poké Ball capture throws use the same transient path for the throw splash, a tactical arc VFX, capture roll feedback, and final modal/error display, while inventory updates, trainer roster updates, token deletion, and capture logs stay in the existing local action path. Remote VFX batches enqueue into the receiving tab's runtime VFX queue, and remote move or Poké Ball feedback advances the same display-only overlay phases through separate page-local refs that lose to local feedback when both are active. Remote receipt only paints transient visuals and does not run the underlying action. These events are visual-only: they are not saved as map, sheet, campaign, session, metadata, or log state, and receiving clients must not apply mechanics from them. Existing map and sheet API flows remain authoritative for persisted game state.

## GM/player trust-based access and player profiles

The app uses a simple role picker:

- **GM** sessions can access editing, player profile management, and encounter-management tools.
- **Player** sessions select a persistent player profile, see player-visible maps, public/linked sheets, Pokédex pages, and PTU reference pages, and control tokens through linked characters.
- **Guest** sessions are redirected to login.

The selected role is stored in a cookie and checked by client navigation and server routes. Player-specific authority comes from the selected persistent profile's linked Pokémon/trainer sheet refs, not from map shares or live-session assignments. This is a local table trust model, not hardened public authentication. See [Player profiles and linked character control](player-profiles.md) for the current play model.

## Normal live-play authority direction

Normal multiplayer play stays on persistent profiles and regular `/maps/<slug>` routes. Live play uses server-authoritative commands with `opId` idempotency, `baseRevision` checks, map/sheet revisions, profile/token-control validation, authoritative SQLite persistence, and patch/result realtime broadcasts. Shop checkout commands launched from map interfaces also reload the referenced map, verify the interface points at the checked-out shop, enforce player map access and profile token control, and check configured interface range before any money, stock, or inventory write.

Setup/edit mode uses revision-checked whole-document SQLite saves and debounced autosave for GM preparation and maintenance. Live gameplay must not use browser-owned whole-map autosave or last-writer-wins document replacement as its concurrency strategy. Normal map-token, sheet-combat, move-usage, initiative, hazard, field-effect, terrain, token placement, maneuver, ability, and order mutations dispatch live-play commands instead of document replacement saves. Shared group inventory currently uses page-level revision-checked saves and trainer transfer APIs; future `groupInventory` live-play command scopes should be added only when in-map item consumption requires that command boundary.

Legacy `/sessions` routes and archived documents are maintenance-only for the old guarded session-local socket/lobby surface. They are not the normal profile-play architecture. See [Live play authority](live-play-authority.md), [Archived legacy live-session documents](archive/live-session/README.md), and [ADR 009: Server-authoritative profile play](adrs/009-server-authoritative-profile-play.md).

## Three.js/isometric map area

The map table combines Vue controls with a Three.js-rendered isometric scene.

- `src/components/IsometricGrid.client.vue` bridges Vue state to the rendered map.
- `src/utils/isometric/` handles scene setup, grid/voxel rendering, token sprites, movement previews, transient move VFX, pointer interactions, context menus, hazards, field effects, weather visuals, lighting, render scheduling, and resource cleanup.
- `src/components/map/` provides the surrounding product UI for terrain editing, initiative, field effects, hazards, token controls, and automation panels.

The scene uses dirty render scheduling: Vue watchers, pointer interactions, async texture loads, resize/camera events, and document visibility lifecycle events request focused invalidation reasons, while active animation sources keep frames alive only while visual work is still changing. See [Isometric render scheduler architecture](render-scheduler-architecture.md) for the current dirty-rendering flow and extension checklist.

Maps persist sparse terrain voxels, token placements, shop interface references, hazards, field effects, lights, initiative state, and metadata in SQLite document payloads. Shop interfaces only point at authoritative shop table slugs; catalog, price, stock, and open/closed state remain in shop table documents. Player token control is derived at runtime by matching a placement's `sheetKind`/`sheetSlug` to the selected player profile's linked character refs.

## Encounter tooling

Encounter tooling is built around filesystem-backed JSON tables in `encounter_tables/`.

- `/encounter-tables` lets a GM browse and edit tables.
- `/generate` rolls tables and can generate wild Pokémon sheet documents; spawn flows persist created campaign sheets into SQLite.
- The optional `just encounter ...` commands use the same table data from the terminal.

This keeps browser and CLI workflows aligned around the same inspectable data files.

## Reference data

The app exposes PTU reference material through searchable/browsable routes for moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges. Reference data is structured in JSON and TypeScript modules so it can support both display pages and sheet/map automation helpers, including deliberate 3D-table differences from upstream PTU text.

## Production limitations

Rotom Table is strongest as a local-development or private trusted-table tool. Private VPS campaign writes are gated by `ROTOM_ENABLE_HOSTED_WRITES=1` for routes that have been moved to the hosted-write policy, including map routes and SQLite-backed live-play commands; the current role picker still assumes trusted table users. Covered Pokédex maintenance writes a campaign override diff under `data/reference-overrides/` instead of mutating app-owned `data/reference/`. See the [API route mutation audit](api-route-mutation-audit.md) for current route coverage. A public hosted version should replace the auth model, define a durable persistence layer, review mutating routes, review asset/content rights, and decide which JSON data should become static reference content versus private campaign state.
