# Review guide

Rotom Table is best reviewed as a private trusted-table product-style application: it has a real campaign workflow, a large typed domain, filesystem persistence, and substantial UI surface area.

## What to inspect first

1. **README positioning** — the first screen explains the project, private trusted-table caveats, fan-project boundaries, and quick start.
2. **Architecture notes** — read [architecture.md](architecture.md) for the high-level shape before diving into code.
3. **Data model notes** — read [data-model.md](data-model.md) to understand why the repository uses JSON data files instead of a hosted database.
4. **Map workflow** — inspect `src/pages/maps/[slug].vue`, `src/components/IsometricGrid.client.vue`, `src/components/map/`, `src/composables/map-editor/`, and `src/utils/isometric/`.
5. **Sheet workflow** — inspect `src/pages/sheets/`, `src/composables/sheets/`, `src/types/characterSheet.ts`, `src/types/trainerSheet.ts`, and `src/utils/sheets/`.
6. **Server persistence** — inspect `server/api/`, `server/useCases/`, `server/utils/*Storage.ts`, and `shared/` helpers.
7. **Tests** — skim `tests/server/`, `tests/composables/`, `tests/shared/`, and `tests/utils/` for behaviour-focused coverage.

## Key routes/pages

| Route | Why it matters |
| --- | --- |
| `/login` | Shows the trust-based GM/Player role picker and player profile selection flow. |
| `/settings` | GM-only settings and campaign folder controls. |
| `/players` | GM-only profile list plus Pokémon/trainer sheet link management. |
| `/maps` | Map library and folder management. |
| `/maps/:slug` | Main isometric table, terrain editing, token placement, initiative, field effects, and automation controls. |
| `/sheets` | Pokémon and trainer sheet library. |
| `/sheets/:slug` | Pokémon sheet editor backed by filesystem JSON. |
| `/sheets/trainers/:slug` | Trainer sheet editor backed by filesystem JSON. |
| `/group-inventory` | Shared party inventory page with GM revision-checked saves and linked-trainer transfer flows. |
| `/pokedex` and `/pokedex/:pokemon_name` | Search/filter/detail flow over reference data. |
| `/generate` | GM-only encounter generation from JSON encounter tables. |
| `/encounter-tables` | GM-only encounter-table browser/editor. |
| `/moves`, `/maneuvers`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, `/edges` | PTU reference pages built from app-owned structured data. |

## Key source areas

- `src/pages/` — Nuxt routes and page-level composition.
- `src/components/` — reusable Vue UI, including map controls, library cards, sheet editors, encounter panels, and reference components.
- `src/components/IsometricGrid.client.vue` and `src/utils/isometric/` — Three.js scene setup, rendering, interactions, tokens, weather, hazards, movement previews, and resource cleanup.
- `src/composables/` — page and feature orchestration for libraries, maps, sheets, encounters, and auth.
- `src/types/` — domain types for maps, sheets, trainers, encounters, Pokémon, and app-owned PTU reference data.
- `src/utils/` — route helpers, autosave, persistence clients, map/sheet/reference domain helpers, and automation logic.
- `server/api/` — Nitro endpoints for maps, sheets, encounters, Pokédex data, trainer sprites, and realtime events.
- `server/useCases/` — behaviour-oriented server application logic separated from route handlers.
- `server/utils/` — filesystem paths, JSON persistence, storage helpers, policies, and runtime adapters.
- `shared/` — auth, path, realtime, sheet, and encounter helpers used on both client and server.
- `data/`, `data/reference/`, `data/reference-overrides/`, and `encounter_tables/` — filesystem-backed campaign data, app-owned reference data, campaign reference override diffs, and encounter definitions consumed by the app. `ptu-data/` is documentary upstream/source material.
- `tests/` — Vitest coverage for server use cases, composables, shared helpers, and pure domain utilities.

## Key scripts

| Command | Use |
| --- | --- |
| `npm install` | Install dependencies for local development. |
| `npm run dev` | Start the local Nuxt development server. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest suite once. |
| `npm run build` | Build the Nuxt app. |
| `npm run start` | Start the already-built Nitro server for private Node hosting or production-style smoke checks. |
| `npm run check:move-automation` | Check explicit move automation coverage. |
| `just` | List optional helper commands, if `just` is installed. |
| `just encounter ... preview` | Preview generated encounter sheets without writing permanent files. |
| `just pokemon`, `just move`, `just ability`, etc. | Query app-owned PTU reference data from the terminal. |

## What the project demonstrates

- A long-running personal tool with real users/workflows rather than a small sample app.
- Product thinking: GM/player modes, persistent player profiles, linked-character control, route organisation, private data safety, autosave, search, libraries, editors, and dense tabletop controls.
- TypeScript/Nuxt structure across pages, composables, utilities, server routes, shared helpers, and tests.
- Interactive UI complexity: Three.js isometric map rendering, token interactions, initiative, field effects, hazards, and sheet-driven map state.
- Domain modelling for 3D tabletop maps, Pokémon sheets, trainer sheets, encounter tables, app-owned PTU reference content, and generated wild sheets.
- Data-management discipline: JSON files remain human-inspectable and suitable for Git diffing, backups, and private campaign ownership.

## Intentionally not production-grade

- **Authentication** — the GM/Player picker and persistent player profiles are trust-based table conveniences. They are appropriate for a private trusted table, not a public identity system.
- **Persistence** — data is written to filesystem-backed JSON in local development and private trusted-table hosting. A public hosted version should replace this with an explicit persistence design.
- **Production writes** — several mutating API routes are disabled in production mode by design.
- **Multi-tenancy/collaboration** — this is not a SaaS app, public VTT, or shared database platform.
- **IP/licensing posture** — this is an unofficial fan-made utility and does not claim ownership of Pokémon/PTU names, images, or concepts.
