# Rotom Table

[![CI](https://github.com/prodmodfour/rotom-table/actions/workflows/ci.yml/badge.svg)](https://github.com/prodmodfour/rotom-table/actions/workflows/ci.yml)
![Nuxt 3](https://img.shields.io/badge/Nuxt-3-00DC82?logo=nuxtdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict%20app-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-tested-6E9F18?logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/license-MIT%20(original%20code)-22c55e)
![Private VPS](https://img.shields.io/badge/private%20VPS-trusted%20table-334155)
![Fan project](https://img.shields.io/badge/fan%20project-unofficial-f59e0b)

Rotom Table is a long-running hobby/passion project: a private-hostable Nuxt 3 tabletop companion for Pokémon Tabletop United campaigns. It brings an isometric map table, editable Pokémon and trainer sheets, shared party inventory, encounter-table tooling, a searchable Pokédex, and PTU reference pages into one browser app backed by SQLite live-play state and inspectable campaign maintenance data.

The project is intentionally product-shaped rather than tutorial-sized. It demonstrates TypeScript/Nuxt application structure, complex Vue UI, Three.js scene management, domain modelling for tabletop rules, hosted/private deployment workflows, campaign JSON persistence, and long-term ownership of a feature-rich tool.

Rotom Table is a fan-made tabletop utility, not an official or commercial Pokémon product. It uses a trust-based **GM / Player** role picker for trusted campaign-table use; it is **not hardened public authentication** and should not be exposed as a public multi-user service without replacing those assumptions.

## Quick start

Use Node.js 24 LTS with npm, then install and run the app:

```bash
npm install
npm run dev
```

Nuxt will print the local URL, usually `http://localhost:3000`. Open it in a browser and choose **GM Login** for editing/encounter tools or **Player Login** to choose the GM-created persistent player profile for this browser. GMs can open `/players` to create profiles and link or unlink existing Pokémon and trainer sheets to those profiles. When logged in as a player, the app navigation shows the selected profile and lets you switch or clear it while keeping map/sheet libraries, shared inventory, Pokédex, and reference pages available; direct map-control and editable sheet routes ask profileless players to choose a profile before continuing. On map pages, players and GMs use the normal navigation rail; profile-linked token control no longer requires attach-current-map, session-map management controls, or the legacy session lobby.

To keep private campaign JSON and campaign-owned reference override diffs in a separate workspace or Git repository, start Nuxt with a campaign root:

```bash
ROTOM_CAMPAIGN_ROOT=../my-rotom-campaign npm run dev
```

See [Campaign repositories](docs/campaign-repositories.md) for the expected layout.

## Private VPS hosting

Rotom Table's primary deployment shape is now private trusted-table hosting: run the built Nitro server for a known campaign group, keep campaign JSON and the live-play SQLite database in operator-controlled campaign storage such as `ROTOM_CAMPAIGN_ROOT`, and put the URL behind an outer access gate. Production campaign writes fail closed unless the private operator explicitly sets `ROTOM_ENABLE_HOSTED_WRITES=1`. The GM/Player picker is still not public authentication, and the app is not a public multi-user service. Start with the [private VPS hosting runbook](docs/private-vps-hosting.md), then follow the [deployment smoke checklist](docs/private-vps-deployment-smoke-checklist.md) and [backup runbook](docs/private-vps-backups.md) for host-specific validation and recovery practice.

Recommended verification commands:

```bash
npm run typecheck
npm test
npm run build
```

## Autonomous build loop

This checkout includes a ticket-driven autonomous build loop for the group inventory wave, mapping GitHub issues #27-#44 to `BUILD_TICKETS.md`. See [docs/autonomous-build.md](docs/autonomous-build.md) for setup and usage.

Run one local cycle from a clean working tree:

```bash
scripts/build-loop.sh --max-cycles 1 --no-push
```

Long runs show concise live Pi progress and tool events by default. From another terminal, use `just follow` to attach to the active loop and `just stop` to request a graceful stop after its current attempt/cycle reaches a safe boundary. See [Autonomous build loop](docs/autonomous-build.md#follow-and-gracefully-stop-a-long-run) for output modes, logging, and exact stop semantics.

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Nuxt development server for local development. |
| `npm run dev:session:lan` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and LAN binding (`0.0.0.0:3000`). |
| `npm run dev:session:tunnel` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and loopback binding (`127.0.0.1:3000`) for a named tunnel. |
| `npm run build` | Build the Nuxt app. |
| `npm run start` | Start the built Nitro server with `node .output/server/index.mjs` after `npm run build` for private Node hosting or production-style smoke checks. |
| `npm run preview` | Preview the built app. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest test suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run check:move-automation` | Validate semantic move-automation metadata; add `-- --report` or `-- --json` for deterministic progress groups. |
| `npm run audit:move-automation-legacy -- --report` | Report deterministic, non-authoritative audit metadata for registered v1 moves. |
| `npm run check:move-automation-legacy-links` | Verify registered v1 source/version/definition fingerprints against the semantic manifest. |
| `npm run sync:item-sprites` | Sync item sprite assets. |
| `npm run generate:profile-sprites` | Generate rectangular Pokémon/trainer profile portraits under `public/profile-sprites/` from front-facing sprite assets. |


## Features

- **Isometric map table** — create map folders, edit maps, build voxel terrain, place hazards, manage field effects, spawn Pokémon and trainer tokens, move/turn tokens, track initiative, and use move/ability automation. Players browse GM-marked player-visible maps and control tokens through linked character sheets.
- **Sheet library** — create, organise, rename, edit, and autosave Pokémon and trainer sheets from the browser. GMs manage library files; players browse public sheets plus sheets linked to their selected profile.
- **Shared party inventory** — view the campaign-level group inventory, let GMs save direct edits with revision protection, and transfer items atomically between party inventory and eligible trainer sheets.
- **Pokédex browser** — search and filter Pokémon entries, view sprites and detail panes, and jump directly to Pokémon-specific pages.
- **Reference library** — browse moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges.
- **Encounter tools** — manage JSON encounter tables, roll previews, and generate wild Pokémon sheets into the sheet library.
- **GM/player access modes** — GM-only routes and controls are hidden from the player role and checked on server routes; Player Login asks for a persistent player profile before continuing, and linked characters grant sheet editing plus map-token control.
- **Campaign storage** — runtime maps, sheets, trainers, and shared group inventory live in SQLite under `ROTOM_CAMPAIGN_ROOT` or `ROTOM_DB_PATH`; player profiles, encounter tables, campaign reference override diffs, explicit JSON exports, and GM-cropped profile image overrides remain inspectable campaign-owned data for private backup and review.



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
- `data/reference/` holds app-owned PTU JSON/TypeScript data consumed at runtime; campaign-owned `data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, `data/reference-overrides/`, and `encounter_tables/` can live in the app checkout or under `ROTOM_CAMPAIGN_ROOT`; `ptu-data/` is documentary upstream/source material and parser tooling.
- `tests/` contains Vitest coverage across server use cases, composables, shared helpers, and domain utilities.

See [docs/architecture.md](docs/architecture.md) for more detail. For the normal live-play command/revision/idempotency direction and the setup/edit autosave boundary, see [docs/live-play-authority.md](docs/live-play-authority.md).

## Common routes and endpoints

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the map library. |
| `/api/health` | No-secret JSON health check for private host and reverse-proxy monitoring. |
| `/login` | Choose the GM role or select a GM-created persistent player profile for Player Login. |
| `/sessions` | Direct-only legacy live-session identity/socket lobby for maintenance smoke checks; not linked from normal app navigation or required for profile-based play. |
| `/settings` | GM-only campaign settings and campaign folder controls. |
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

Campaign-owned paths (`data/maps/`, `data/sheets/`, `data/trainers/`, `data/player-profiles/`, `data/reference-overrides/`, `assets/`, and `encounter_tables/`) are resolved under `ROTOM_CAMPAIGN_ROOT` when set; otherwise they use the app checkout. Base PTU reference files stay app-owned under `data/reference/`; Pokédex maintenance writes campaign overrides under `data/reference-overrides/pokedex.json`, and profile image recrops write image overrides under `assets/profile-sprites/pokemon/`.

| Path | What it contains |
| --- | --- |
| `data/maps/` | Saved map JSON and map-adjacent files. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `data/player-profiles/` | Persistent player profile JSON with linked Pokémon/trainer character refs; ignored/private campaign data. |
| `data/sheets/` | Pokémon character-sheet JSON, including generated wild sheets. |
| `data/trainers/` | Trainer sheet JSON. |
| `encounter_tables/` | Encounter-table JSON, grouped by folder/region. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `data/reference-overrides/` | Campaign-owned reference override diffs, currently Pokédex maintenance entries. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `assets/profile-sprites/pokemon/` | Campaign-owned Pokémon profile image overrides saved by the GM Pokédex cropper. Resolved under `ROTOM_CAMPAIGN_ROOT` when set. |
| `data/reference/` | App-owned PTU reference JSON used by runtime pages, sheets, lookup helpers, and automation. |
| `books/markdown/` | Markdown source/reference content. |
| `ptu-data/` | Documentary upstream PTU parsing/source helpers; not the runtime source of truth. |
| `public/` | Public static assets, including generated profile portraits under `public/profile-sprites/`. |
| `trainer_sizes/sprites/` | Trainer sprite assets served by Nitro at `/trainer-sprites`. |
| `src/` | Nuxt app source: pages, components, composables, assets, and utilities. |
| `server/` | Nitro API routes and filesystem persistence helpers. |
| `shared/` | Shared auth/path/sheet helpers used by both app and server. |
| `tests/` | Vitest coverage for shared logic, utilities, composables, and server helpers. |

Saved sheets, maps, player profiles, and campaign reference overrides are edited by the app itself. The live-play SQLite database defaults to `rotom-table.sqlite` under `ROTOM_CAMPAIGN_ROOT` and can be moved with `ROTOM_DB_PATH`; live-play commands persist authoritative map, sheet, and operation-result revisions through the SQLite repositories. JSON-backed setup and library routes remain for GM preparation, inspection, imports, exports, and backups, not as live gameplay authority. Legacy live session snapshots and optional event logs live under `data/sessions/` only when the legacy session host is used for maintenance smoke checks. In development, Nuxt/Vite ignores changes under `data/sheets`, `data/trainers`, `data/player-profiles`, `data/maps`, and `data/reference-overrides` so autosaves and admin edits do not force a full page reload. `.gitignore` is configured to keep personal campaign data, campaign reference overrides, databases, and session runtime files out of the repository while allowing curated examples to remain inspectable.



## Optional `just` commands

The `justfile` includes convenience commands for PTU reference lookups, encounter rolls, and generated sheets.

```bash
just                         # show available commands
just pokemon "Pikachu"       # lookup a Pokémon
just move "Thunderbolt"      # lookup a move
just ability "Static"        # lookup an ability
just encounter               # list available encounter regions
just encounter <region>      # list tables in a region
just encounter <region> <table> <slot-count>
```

The `slot-count` argument is an encounter slot count: each slot rolls once, and `Nothing` rolls do not create Pokémon. When writing JSON output, generated Pokémon are written under `data/sheets/wild/<table>_<slot-count>/` by default, so the number of files can be fewer than the requested slots.

Preview without writing files:

```bash
just encounter <region> <table> <slot-count> preview
```

Clear generated encounter output:

```bash
just encounter --clear
```

## Working with encounter tables

Encounter tables live in `encounter_tables/` and are exposed through the GM-only `/encounter-tables` route. A table has a name, level range, and weighted entries with species/level data. The app can create, rename, move, delete, and save encounter tables during development or private hosted play with hosted writes enabled.

The `/generate` page rolls encounter slots from those tables and can either preview generated results, write generated sheets, or spawn generated Pokémon onto a map.

## Auth and access model

Rotom Table uses a trust-based role picker, not password authentication:

- **GM** — full map, sheet, encounter, and settings access.
- **Player** — player-facing view with player-visible maps, public/linked sheets, Pokédex, reference pages, and linked-character token control.
- **Guest** — redirected to `/login`.

Players choose a GM-created persistent player profile after Player Login. The selected profile's linked Pokémon/trainer sheets are the source of player-specific sheet editing and map-token control. Server routes also check the session role and selected profile for protected actions. Live gameplay uses explicit server-authoritative commands; browser-owned whole-map autosave is only a setup/edit workflow, not a live multiplayer strategy. See [docs/player-profiles.md](docs/player-profiles.md), [docs/live-play-authority.md](docs/live-play-authority.md), [ADR 009: Server-authoritative profile play](docs/adrs/009-server-authoritative-profile-play.md), and the [private VPS live-play smoke checklist](docs/private-vps-live-play-smoke.md). Treat this as a private trusted-table workflow, not a hardened public authentication system.


## Contributing, security, and notices

- See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, checks, data hygiene, and fan-project boundaries.
- See [SECURITY.md](SECURITY.md) for private trusted-table security expectations and reporting guidance.
- See [NOTICE.md](NOTICE.md) and [docs/fan-project-notice.md](docs/fan-project-notice.md) for fan project and reuse boundaries.

## License

Original Rotom Table application code, project-specific documentation, and original tooling are available under the MIT License. See [LICENSE](LICENSE).

That license does not grant rights to Pokémon-related or PTU-related names, images, rules terms, concepts, sprites, reference text, or other third-party materials.

## Fan project notice

Rotom Table is a fan-made tabletop utility. Pokémon-related and PTU-related names, images, and concepts belong to their respective owners. This repository does not claim official affiliation, endorsement, or ownership of those materials.
