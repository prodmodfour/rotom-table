# Rotom Table

[![CI](https://github.com/prodmodfour/rotom-table/actions/workflows/ci.yml/badge.svg)](https://github.com/prodmodfour/rotom-table/actions/workflows/ci.yml)
![Nuxt 3](https://img.shields.io/badge/Nuxt-3-00DC82?logo=nuxtdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict%20app-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-tested-6E9F18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/license-MIT%20(original%20code)-22c55e)
![Local-first](https://img.shields.io/badge/local--first-filesystem%20JSON-334155)
![Fan project](https://img.shields.io/badge/fan%20project-unofficial-f59e0b)

Rotom Table is a long-running hobby/passion project: a local-first Nuxt 3 tabletop companion for Pokémon Tabletop United campaigns. It brings an isometric map table, editable Pokémon and trainer sheets, encounter-table tooling, a searchable Pokédex, and PTU reference pages into one browser app backed by inspectable JSON files.

The project is intentionally product-shaped rather than tutorial-sized. It demonstrates TypeScript/Nuxt application structure, complex Vue UI, Three.js scene management, domain modelling for tabletop rules, filesystem-backed persistence, data-management workflows, and long-term ownership of a feature-rich tool.

Rotom Table is a fan-made tabletop utility, not an official or commercial Pokémon product. It uses a trust-based **GM / Player** role picker for local campaign use; it is **not hardened public authentication** and should not be exposed as a public multi-user service without replacing those assumptions.

## Quick start

Use Node.js 24 LTS with npm, then install and run the app:

```bash
npm install
npm run dev
```

Nuxt will print the local URL, usually `http://localhost:3000`. Open it in a browser and choose **GM Login** for editing/encounter tools or **Player Login** to choose the GM-created persistent player profile for this browser. GMs can open `/players` to create profiles and link or unlink existing Pokémon and trainer sheets to those profiles. When logged in as a player, the app navigation shows the selected profile and lets you switch or clear it while keeping map/sheet libraries, Pokédex, and reference pages available; direct map-control and editable sheet routes ask profileless players to choose a profile before continuing. On map pages, players and GMs use the normal navigation rail; profile-linked token control no longer requires attach-current-map, session-map management controls, or the legacy session lobby.

To keep private campaign JSON in a separate Git repository, start Nuxt with a campaign root:

```bash
ROTOM_CAMPAIGN_ROOT=../my-rotom-campaign npm run dev
```

See [Campaign repositories](docs/campaign-repositories.md) for the expected layout.

## Private VPS hosting

Rotom Table remains local-first by default. For an always-online table, use the private trusted-table VPS path only behind an outer access gate; the GM/Player picker is not public authentication, and the app is not a public multi-user service. Start with the [private VPS hosting runbook](docs/private-vps-hosting.md), then follow the [deployment smoke checklist](docs/private-vps-deployment-smoke-checklist.md) and [backup runbook](docs/private-vps-backups.md) for host-specific validation and recovery practice.

Recommended verification commands:

```bash
npm run typecheck
npm test
npm run build
```


## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Nuxt development server without enabling live session hosting. |
| `npm run dev:session:lan` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and LAN binding (`0.0.0.0:3000`). |
| `npm run dev:session:tunnel` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and loopback binding (`127.0.0.1:3000`) for a named tunnel. |
| `npm run build` | Build the Nuxt app. |
| `npm run start` | Start the built Nitro server with `node .output/server/index.mjs` after `npm run build` for private Node hosting or production-style smoke checks. |
| `npm run preview` | Preview the built app. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest test suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run check:move-automation` | Check move automation coverage. |
| `npm run sync:item-sprites` | Sync item sprite assets. |
| `npm run generate:profile-sprites` | Generate rectangular Pokémon/trainer profile portraits under `public/profile-sprites/` from front-facing sprite assets. |


## Features

- **Isometric map table** — create map folders, edit maps, build voxel terrain, place hazards, manage field effects, spawn Pokémon and trainer tokens, move/turn tokens, track initiative, and use move/ability automation. Players browse GM-marked player-visible maps and control tokens through linked character sheets.
- **Sheet library** — create, organise, rename, edit, and autosave Pokémon and trainer sheets from the browser. GMs manage library files; players browse public sheets plus sheets linked to their selected profile.
- **Pokédex browser** — search and filter Pokémon entries, view sprites and detail panes, and jump directly to Pokémon-specific pages.
- **Reference library** — browse moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges.
- **Encounter tools** — manage JSON encounter tables, roll previews, and generate wild Pokémon sheets into the sheet library.
- **GM/player access modes** — GM-only routes and controls are hidden from the player role and checked on server routes; Player Login asks for a persistent player profile before continuing, and linked characters grant sheet editing plus map-token control.
- **Filesystem-backed data** — maps, sheets, trainers, player profiles, and encounter tables are stored as JSON in the app checkout by default, or under `ROTOM_CAMPAIGN_ROOT` when using a separate private campaign repo, for easy inspection, backup, and diffing.



## Tech stack

- [Nuxt 3](https://nuxt.com/) and Vue 3
- TypeScript
- Vitest
- Three.js
- npm
- Optional Python/`just` helper scripts for PTU reference lookup, encounter generation, and sprite-profile asset generation

## Architecture at a glance

- `src/` contains the Nuxt app: pages, components, composables, assets, and browser-side utilities.
- `server/` contains Nitro API routes, use cases, and filesystem persistence helpers.
- `shared/` contains auth, path, realtime, sheet, and encounter helpers shared by app and server code.
- `data/reference/` holds app-owned PTU JSON/TypeScript data consumed at runtime; campaign-owned `data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, and `encounter_tables/` can live in the app checkout or under `ROTOM_CAMPAIGN_ROOT`; `ptu-data/` is documentary upstream/source material and parser tooling.
- `tests/` contains Vitest coverage across server use cases, composables, shared helpers, and domain utilities.

See [docs/architecture.md](docs/architecture.md) for more detail.

## Common routes and endpoints

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the map library. |
| `/api/health` | No-secret JSON health check for private host and reverse-proxy monitoring. |
| `/login` | Choose the local GM role or select a GM-created persistent player profile for Player Login. |
| `/sessions` | Direct-only legacy live-session identity/socket lobby for maintenance smoke checks; not linked from normal app navigation or required for profile-based play. |
| `/settings` | GM-only campaign settings and local campaign folder controls. |
| `/players` | GM-only player profile list plus Pokémon/trainer sheet link and unlink management. |
| `/maps` | Map library and folders; players see player-visible maps only. |
| `/maps/:slug` | Map editor/table view with profile-linked player token control. |
| `/sheets` | Pokémon and trainer sheet library; players see public and selected-profile-linked sheets. |
| `/sheets/:slug` | Pokémon sheet editor. |
| `/sheets/trainers/:slug` | Trainer sheet editor. |
| `/pokedex` | Searchable Pokédex browser. |
| `/pokedex/:pokemon_name` | Pokédex detail view for one Pokémon. |
| `/generate` | GM encounter generation page. |
| `/encounter-tables` | GM encounter-table library/editor. |
| `/moves`, `/maneuvers`, `/abilities`, `/capabilities`, `/conditions`, `/rules`, `/items`, `/features`, `/edges` | PTU reference pages. |

## Data layout

Campaign-owned paths (`data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, and `encounter_tables/`) are resolved under `ROTOM_CAMPAIGN_ROOT` when set; otherwise they use the app checkout.

| Path | What it contains |
| --- | --- |
| `data/maps/` | Saved map JSON and map-adjacent local files. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `data/player-profiles/` | Persistent player profile JSON with linked Pokémon/trainer character refs; ignored/private campaign data. |
| `data/sheets/` | Pokémon character-sheet JSON, including generated wild sheets. |
| `data/trainers/` | Trainer sheet JSON. |
| `encounter_tables/` | Encounter-table JSON, grouped by folder/region. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `data/reference/` | App-owned PTU reference JSON used by runtime pages, sheets, lookup helpers, and automation. |
| `books/markdown/` | Markdown source/reference content. |
| `ptu-data/` | Documentary upstream PTU parsing/source helpers; not the runtime source of truth. |
| `public/` | Public static assets, including generated profile portraits under `public/profile-sprites/`. |
| `trainer_sizes/sprites/` | Trainer sprite assets served by Nitro at `/trainer-sprites`. |
| `src/` | Nuxt app source: pages, components, composables, assets, and utilities. |
| `server/` | Nitro API routes and filesystem persistence helpers. |
| `shared/` | Shared auth/path/sheet helpers used by both app and server. |
| `tests/` | Vitest coverage for shared logic, utilities, composables, and server helpers. |

Saved sheets, maps, and player profiles are edited by the app itself. Legacy live session snapshots and optional event logs live under `data/sessions/` only when the legacy session host is used for maintenance smoke checks. In development, Nuxt/Vite ignores changes under `data/sheets`, `data/trainers`, `data/player-profiles`, and `data/maps` so autosaves do not force a full page reload. `.gitignore` is configured to keep personal campaign data and session runtime files out of the repository while allowing curated examples to remain inspectable.



## Optional `just` commands

The `justfile` includes convenience commands for PTU reference lookups, encounter rolls, and generated sheets.

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

Encounter tables live in `encounter_tables/` and are exposed through the GM-only `/encounter-tables` route. A table has a name, level range, and weighted entries with species/level data. The app can create, rename, move, delete, and save encounter tables during local development.

The `/generate` page rolls from those tables and can either preview generated sheets or write them into the sheet data tree.

## Auth and access model

Rotom Table currently uses a trust-based role picker, not password authentication:

- **GM** — full map, sheet, encounter, and settings access.
- **Player** — player-facing view with player-visible maps, public/linked sheets, Pokédex, reference pages, and linked-character token control.
- **Guest** — redirected to `/login`.

Players choose a GM-created persistent player profile after Player Login. The selected profile's linked Pokémon/trainer sheets are the source of player-specific sheet editing and map-token control. Server routes also check the session role and selected profile for protected actions. See [docs/player-profiles.md](docs/player-profiles.md) for the full player profile flow. Treat this as a local/campaign-table workflow, not a hardened public authentication system.


## Contributing, security, and notices

- See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, checks, data hygiene, and fan-project boundaries.
- See [SECURITY.md](SECURITY.md) for local-first/trust-based security expectations and reporting guidance.
- See [NOTICE.md](NOTICE.md) and [docs/fan-project-notice.md](docs/fan-project-notice.md) for fan project and reuse boundaries.

## License

Original Rotom Table application code, project-specific documentation, and original tooling are available under the MIT License. See [LICENSE](LICENSE).

That license does not grant rights to Pokémon-related or PTU-related names, images, rules terms, concepts, sprites, reference text, or other third-party materials.

## Fan project notice

Rotom Table is a fan-made tabletop utility. Pokémon-related and PTU-related names, images, and concepts belong to their respective owners. This repository does not claim official affiliation, endorsement, or ownership of those materials.
