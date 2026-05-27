# Architecture

This is a high-level overview intended for reviewers. It avoids implementation detail and focuses on the product shape.

## Nuxt/Vue app

Rotom Table is a Nuxt 3 application with the app source under `src/`.

- `src/pages/` defines the browser routes for maps, sheets, Pokédex, encounter tools, login, and reference pages.
- `src/components/` contains reusable Vue components for dense product UI: library grids, editors, map controls, sheet rows, encounter panels, and reference cards.
- `src/composables/` coordinates feature state, API calls, autosave flows, and page-level behaviours.
- `src/utils/` contains pure domain helpers, route helpers, persistence clients, reference indexes, map/sheet utilities, and automation logic.
- `src/types/` captures the map, sheet, trainer, encounter, Pokémon, and app-owned PTU reference models used across the app.

## Nitro/server routes

The `server/` directory holds Nitro API routes and server-side application logic.

- `server/api/` exposes endpoints for maps, sheets, player profiles, encounters, Pokédex data, trainer sprites, and realtime events.
- `server/useCases/` keeps core behaviours separate from HTTP route handlers.
- `server/utils/` contains filesystem paths, JSON read/write helpers, storage adapters, policies, and runtime wrappers.

This structure keeps route handlers thin and makes persistence-heavy behaviours easier to test.

## Local filesystem-backed JSON data

Rotom Table is local-first. Campaign state is stored as JSON in the repository tree rather than in a hosted database.

- Maps live under `data/maps/`.
- Persistent player profiles live under `data/player-profiles/`.
- Pokémon sheets live under `data/sheets/`.
- Trainer sheets live under `data/trainers/`.
- Encounter tables live under `encounter_tables/`.
- App-owned PTU reference content lives under `data/reference/` with indexes in `data/ptuReference.ts` and `src/utils/reference/`. `ptu-data/` is documentary upstream/source material and parser output, not the runtime source of truth.

This makes data easy to inspect, back up, diff, and repair while developing or running a home campaign.

## Shared helpers

The `shared/` directory contains small helpers used by both app and server code, such as auth role values, path validation, sheet kinds, realtime message shapes, and encounter-table normalization. Keeping these definitions shared reduces drift between browser and server assumptions.

## GM/player trust-based access and player profiles

The app uses a simple role picker:

- **GM** sessions can access editing, player profile management, and encounter-management tools.
- **Player** sessions select a persistent player profile, see player-visible maps, public/linked sheets, Pokédex pages, and PTU reference pages, and control tokens through linked characters.
- **Guest** sessions are redirected to login.

The selected role is stored in a cookie and checked by client navigation and server routes. Player-specific authority comes from the selected persistent profile's linked Pokémon/trainer sheet refs, not from map shares or live-session assignments. This is a local table trust model, not hardened public authentication. See [Player profiles and linked character control](player-profiles.md) for the current play model.

## Three.js/isometric map area

The map table combines Vue controls with a Three.js-rendered isometric scene.

- `src/components/IsometricGrid.client.vue` bridges Vue state to the rendered map.
- `src/utils/isometric/` handles scene setup, grid/voxel rendering, token sprites, movement previews, pointer interactions, context menus, hazards, field effects, weather visuals, lighting, render scheduling, and resource cleanup.
- `src/components/map/` provides the surrounding product UI for terrain editing, initiative, field effects, hazards, token controls, and automation panels.

The scene uses dirty render scheduling: Vue watchers, pointer interactions, async texture loads, resize/camera events, and document visibility lifecycle events request focused invalidation reasons, while active animation sources keep frames alive only while visual work is still changing. See [Isometric render scheduler architecture](render-scheduler-architecture.md) for the current dirty-rendering flow and extension checklist.

Maps persist sparse terrain voxels, token placements, hazards, field effects, lights, initiative state, and metadata as JSON. Player token control is derived at runtime by matching a placement's `sheetKind`/`sheetSlug` to the selected player profile's linked character refs.

## Encounter tooling

Encounter tooling is built around local JSON tables in `encounter_tables/`.

- `/encounter-tables` lets a GM browse and edit tables.
- `/generate` rolls tables and can generate wild Pokémon sheets into `data/sheets/wild/...`.
- The optional `just encounter ...` commands use the same local table data from the terminal.

This keeps browser and CLI workflows aligned around the same inspectable data files.

## Reference data

The app exposes PTU reference material through searchable/browsable routes for moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges. Reference data is structured in JSON and TypeScript modules so it can support both display pages and sheet/map automation helpers, including deliberate 3D-table differences from upstream PTU text.

## Production limitations

Rotom Table is strongest as a local development/table tool. Several mutating API routes are disabled in production mode, and the current role picker assumes trusted local users. A public hosted version should replace the auth model, define a durable persistence layer, review asset/content rights, and decide which local JSON data should become static reference content versus private campaign state.
