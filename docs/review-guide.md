# Review guide

Rotom Table is best reviewed as a local-first product-style application: it has a real campaign workflow, a large typed domain, filesystem persistence, and substantial UI surface area.

## What to inspect first

1. **README positioning** — the first screen explains the project, local-first caveats, fan-project boundaries, and quick start.
2. **Architecture notes** — read [architecture.md](architecture.md) for the high-level shape before diving into code.
3. **Data model notes** — read [data-model.md](data-model.md) to understand why the repository uses JSON data files instead of a hosted database.
4. **Map workflow** — inspect `src/pages/maps/[slug].vue`, `src/components/IsometricGrid.client.vue`, `src/components/map/`, `src/composables/map-editor/`, and `src/utils/isometric/`.
5. **Sheet workflow** — inspect `src/pages/sheets/`, `src/composables/sheets/`, `src/types/characterSheet.ts`, `src/types/trainerSheet.ts`, and `src/utils/sheets/`.
6. **Server persistence** — inspect `server/api/`, `server/useCases/`, `server/utils/*Storage.ts`, and `shared/` helpers.
7. **Tests** — skim `tests/server/`, `tests/composables/`, `tests/shared/`, and `tests/utils/` for behaviour-focused coverage.

## Key routes/pages

| Route | Why it matters |
| --- | --- |
| `/login` | Shows the trust-based GM/Player session model. |
| `/maps` | Local map library and folder management. |
| `/maps/:slug` | Main isometric table, terrain editing, token placement, initiative, field effects, and automation controls. |
| `/sheets` | Pokémon and trainer sheet library. |
| `/sheets/:slug` | Pokémon sheet editor backed by local JSON. |
| `/sheets/trainers/:slug` | Trainer sheet editor backed by local JSON. |
| `/pokedex` and `/pokedex/:pokemon_name` | Search/filter/detail flow over reference data. |
| `/generate` | GM-only encounter generation from JSON encounter tables. |
| `/encounter-tables` | GM-only encounter-table browser/editor. |
| `/moves`, `/maneuvers`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, `/edges` | PTU reference pages built from structured data. |

## Key source areas

- `src/pages/` — Nuxt routes and page-level composition.
- `src/components/` — reusable Vue UI, including map controls, library cards, sheet editors, encounter panels, and reference components.
- `src/components/IsometricGrid.client.vue` and `src/utils/isometric/` — Three.js scene setup, rendering, interactions, tokens, weather, hazards, movement previews, and resource cleanup.
- `src/composables/` — page and feature orchestration for libraries, maps, sheets, encounters, and auth.
- `src/types/` — domain types for maps, sheets, trainers, encounters, Pokémon, and PTU reference data.
- `src/utils/` — route helpers, autosave, persistence clients, map/sheet/reference domain helpers, and automation logic.
- `server/api/` — Nitro endpoints for maps, sheets, encounters, Pokédex data, trainer sprites, and realtime events.
- `server/useCases/` — behaviour-oriented server application logic separated from route handlers.
- `server/utils/` — filesystem paths, JSON persistence, storage helpers, policies, and runtime adapters.
- `shared/` — auth, path, realtime, sheet, and encounter helpers used on both client and server.
- `data/`, `encounter_tables/`, `ptu-data/` — local campaign data, encounter definitions, and reference data consumed by the app.
- `tests/` — Vitest coverage for server use cases, composables, shared helpers, and pure domain utilities.

## Key scripts

| Command | Use |
| --- | --- |
| `npm install` | Install dependencies for local development. |
| `npm run dev` | Start the local Nuxt development server. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest suite once. |
| `npm run build` | Build the Nuxt app. |
| `npm run check:move-automation` | Check explicit move automation coverage. |
| `just` | List optional helper commands, if `just` is installed. |
| `just encounter ... preview` | Preview generated encounter sheets without writing permanent files. |
| `just pokemon`, `just move`, `just ability`, etc. | Query PTU/reference data from the terminal. |

## What the project demonstrates

- A long-running personal tool with real users/workflows rather than a small sample app.
- Product thinking: GM/player modes, route organisation, local data safety, autosave, search, libraries, editors, and dense tabletop controls.
- TypeScript/Nuxt structure across pages, composables, utilities, server routes, shared helpers, and tests.
- Interactive UI complexity: Three.js isometric map rendering, token interactions, initiative, field effects, hazards, and sheet-driven map state.
- Domain modelling for PTU maps, Pokémon sheets, trainer sheets, encounter tables, reference content, and generated wild sheets.
- Data-management discipline: JSON files remain human-inspectable and suitable for Git diffing, backups, and local campaign ownership.

## Intentionally not production-grade

- **Authentication** — the GM/Player picker is trust-based and cookie-backed. It is appropriate for a local table, not a public identity system.
- **Persistence** — data is written to the repository filesystem in local development. A hosted version should replace this with an explicit persistence design.
- **Production writes** — several mutating API routes are disabled in production mode by design.
- **Multi-tenancy/collaboration** — this is not a SaaS app, public VTT, or shared database platform.
- **IP/licensing posture** — this is an unofficial fan-made utility and does not claim ownership of Pokémon/PTU names, images, or concepts.
