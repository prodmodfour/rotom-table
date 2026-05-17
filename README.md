# Rotom Table

Rotom Table is a local-first Nuxt 3 tabletop companion for Pokémon Tabletop United campaigns. It combines an isometric map table, editable Pokémon and trainer sheets, encounter-table tooling, a searchable Pokédex, and PTU reference pages into one browser app.

The app is designed around a simple trust-based session model: pick **GM** for full editing and encounter tools, or **Player** for the shared player-facing view.

## Features

- **Isometric map table** — create map folders, edit maps, build voxel terrain, place hazards, manage field effects, spawn Pokémon and trainer tokens, move/turn tokens, track initiative, and use move/ability automation.
- **Sheet library** — create, organize, rename, edit, and autosave Pokémon and trainer sheets from the browser.
- **Pokédex browser** — search and filter Pokémon entries, view sprites and detail panes, and jump directly to Pokémon-specific pages.
- **Reference library** — browse moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges.
- **Encounter tools** — manage JSON encounter tables, roll previews, and generate wild Pokémon sheets into the sheet library.
- **GM/player access modes** — GM-only routes and controls are hidden from player sessions.
- **Filesystem-backed data** — maps, sheets, trainers, and encounter tables are stored as JSON in the repository tree for easy inspection and backup.

## Tech stack

- [Nuxt 3](https://nuxt.com/) and Vue 3
- TypeScript
- Vitest
- Three.js
- npm
- Optional Python/`just` helper scripts for PTU data lookup and encounter generation

## Requirements

- Node.js and npm. A current LTS version is recommended.
- Optional: Python 3 for helper scripts in `scripts/` and `ptu-data/`.
- Optional: [`just`](https://github.com/casey/just) for the convenience commands in `justfile`.

## Getting started

```bash
git clone https://github.com/prodmodfour/rotom-table.git
cd rotom-table
npm install
npm run dev
```

Nuxt will print the local development URL, usually:

```text
http://localhost:3000
```

Open the app in your browser and choose **GM Login** or **Player Login**. The current session role is stored in a cookie, so you can log out from the navigation bar to switch roles.

## Common routes

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the map library. |
| `/login` | Choose GM or Player session mode. |
| `/maps` | Map library and folders. |
| `/maps/:slug` | Map editor/table view. |
| `/sheets` | Pokémon and trainer sheet library. |
| `/sheets/:slug` | Pokémon sheet editor. |
| `/sheets/trainers/:slug` | Trainer sheet editor. |
| `/pokedex` | Searchable Pokédex browser. |
| `/pokedex/:pokemon_name` | Pokédex detail view for one Pokémon. |
| `/generate` | GM encounter generation page. |
| `/encounter-tables` | GM encounter-table library/editor. |
| `/moves`, `/maneuvers`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, `/edges` | PTU reference pages. |

## Data layout

| Path | What it contains |
| --- | --- |
| `data/maps/` | Saved map JSON. |
| `data/sheets/` | Pokémon character-sheet JSON. |
| `data/trainers/` | Trainer sheet JSON. |
| `encounter_tables/` | Encounter-table JSON, grouped by folder/region. |
| `books/markdown/` | Markdown source/reference content. |
| `ptu-data/` | PTU data parsing, lookup, and generation helpers. |
| `public/` | Public static assets. |
| `trainer_sizes/sprites/` | Trainer sprite assets served by Nitro at `/trainer-sprites`. |
| `src/` | Nuxt app source: pages, components, composables, assets, and utilities. |
| `server/` | Nitro API routes and filesystem persistence helpers. |
| `shared/` | Shared auth/path/sheet helpers used by both app and server. |
| `tests/` | Vitest coverage for shared logic, utilities, composables, and server helpers. |

Saved sheets and maps are edited by the app itself. In development, Nuxt/Vite ignores changes under `data/sheets`, `data/trainers`, and `data/maps` so autosaves do not force a full page reload.

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Nuxt development server. |
| `npm run build` | Build the Nuxt app. |
| `npm run preview` | Preview the built app. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest test suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run check:move-automation` | Check move automation coverage. |
| `npm run sync:item-sprites` | Sync item sprite assets. |
| `npm run refactor:loop` | Run the refactor loop helper script. |

Recommended pre-commit check:

```bash
npm run typecheck
npm test
npm run build
```

## Optional `just` commands

The `justfile` includes convenience commands for PTU lookups, encounter rolls, and generated sheets.

```bash
just                         # show available commands
just pokemon "Pikachu"       # lookup a Pokémon
just move "Thunderbolt"      # lookup a move
just ability "Static"        # lookup an ability
just encounter               # list available encounter regions
just encounter <region>      # list tables in a region
just encounter <region> <table> <count>
```

Generated encounters are written under `data/sheets/wild/<table>_<count>/` by default, which makes them appear automatically in the `/sheets` page.

Preview without writing files:

```bash
just encounter <region> <table> <count> preview
```

Clear generated encounter output:

```bash
just encounter --clear
```

## Working with encounter tables

Encounter tables live in `encounter_tables/` and are exposed through the GM-only `/encounter-tables` route. A table has a name, level range, and entries with percentage ceilings and species/level data. The app can create, rename, move, delete, and save encounter tables during local development.

The `/generate` page rolls from those tables and can either preview generated sheets or write them into the sheet data tree.

## Auth and access model

Rotom Table currently uses a trust-based role picker, not password authentication:

- **GM** — full map, sheet, encounter, and control-panel access.
- **Player** — shared player view with player-visible maps and sheets.
- **Guest** — redirected to `/login`.

Server routes also check the session role for protected actions. Treat this as a local/campaign-table workflow, not a hardened public authentication system.

## Production notes

This project is strongest as a local development/table tool because many workflows persist JSON directly into the repository tree. Several mutating API routes are guarded against production mode, so use `npm run dev` when you need browser-based editing, autosave, encounter generation, or filesystem-backed management.

For a hosted deployment, decide which data should be static, which data should be persisted elsewhere, and whether to replace the trust-based role picker with real authentication.

## Troubleshooting

**I am redirected to login.**  
Choose GM or Player on `/login`. The chosen role is stored in the `rotom-role` cookie.

**Browser edits are not visible immediately.**  
Most app pages update through local state and realtime events. If you generated or edited files outside the browser, refresh the page or restart the dev server.

**Write actions fail in production.**  
Run the app with `npm run dev`. Production mode intentionally disables several filesystem-mutating endpoints.

**Generated wild sheets do not show up.**  
Check that generated JSON files landed under `data/sheets/`, usually `data/sheets/wild/...`, and refresh the `/sheets` page.

## Contributing notes

- Keep route utilities and generated paths in sync when adding pages.
- Add or update tests in `tests/` for server helpers, persistence logic, and utility behavior.
- Prefer JSON data changes that remain easy to inspect in Git.
- Run `npm run typecheck` and `npm test` before opening a PR.

## License

No license file is currently included. Add a license before publishing reuse terms for this project.

## Fan project notice

Rotom Table is a fan-made tabletop utility. Pokémon-related names, images, and concepts belong to their respective owners.
