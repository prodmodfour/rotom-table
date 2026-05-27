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

```bash
npm install
npm run dev
```

Nuxt will print the local URL, usually `http://localhost:3000`. Open it in a browser and choose **GM Login** for editing/encounter tools or **Player Login** to choose or create the persistent player profile for this browser. When logged in as a player, the app navigation shows the selected profile and lets you switch or clear it while keeping maps, Pokédex, sheets, and reference pages available.

Recommended verification commands:

```bash
npm run typecheck
npm test
npm run build
```

## Reviewer starting points

- [docs/review-guide.md](docs/review-guide.md) — fastest path through the project for recruiters and reviewers.
- [docs/architecture.md](docs/architecture.md) — high-level Nuxt, Nitro, local data, and Three.js architecture.
- [docs/data-model.md](docs/data-model.md) — maps, sheets, trainers, encounter tables, app-owned PTU reference data, and generated sheets.
- [docs/live-session-roadmap.md](docs/live-session-roadmap.md) — GM-hosted live session scope, lifecycle, and non-goals.
- [docs/live-session-glossary.md](docs/live-session-glossary.md) — shared live session vocabulary for identity, commands, revisions, reconnect, and safety.
- [docs/live-session-validation-matrix.md](docs/live-session-validation-matrix.md) — expected tests, smoke checks, docs, and safety reviews for live-session implementation areas.
- [docs/live-session-protocol.md](docs/live-session-protocol.md) — shared live session protocol types, message flow, and accepted/rejected command examples.
- [docs/live-session-socket-protocol.md](docs/live-session-socket-protocol.md) — live session socket route, message examples, heartbeat, reconnect, command flow, and named-tunnel expectations.
- [docs/live-session-table-action-commands.md](docs/live-session-table-action-commands.md) — supported HP, condition, initiative, move/action, hazard, field-effect, and terrain session commands with permissions, conflicts, and limitations.
- [docs/live-session-client-integration.md](docs/live-session-client-integration.md) — how local map mode and explicit session mode coexist, including disconnect and conflict recovery guidance.
- [docs/live-session-map-attachment.md](docs/live-session-map-attachment.md) — GM flow for attaching saved maps to server-owned live session state before players open session maps.
- [docs/live-session-lobby.md](docs/live-session-lobby.md) — GM/player join flow, expected LAN usage, and two-browser lobby smoke checklist.
- [docs/live-session-host-runtime.md](docs/live-session-host-runtime.md) — npm helpers for guarded LAN and named-tunnel session host startup.
- [docs/live-session-public-exposure-checks.md](docs/live-session-public-exposure-checks.md) — no-secret safety banner checks for unsafe public/LAN startup states before sharing join codes.
- [docs/live-session-lan-hosting.md](docs/live-session-lan-hosting.md) — same-Wi-Fi/LAN hosting runbook with startup commands, IP discovery, player URLs, and troubleshooting.
- [docs/live-session-cloudflare-tunnel-hosting.md](docs/live-session-cloudflare-tunnel-hosting.md) — named Cloudflare Tunnel runbook with stable hostname setup, session socket considerations, safety warnings, and rollback steps.
- [docs/live-session-named-tunnel-maintenance.md](docs/live-session-named-tunnel-maintenance.md) — named-tunnel doc accuracy, current Cloudflare assumptions, and safety warnings.
- [docs/live-session-deployment-smoke-checklist.md](docs/live-session-deployment-smoke-checklist.md) — LAN and named-tunnel deployment smoke checklist for two players, reconnect, token movement, initiative, and conflict rejection.
- [docs/live-session-real-flow-smoke.md](docs/live-session-real-flow-smoke.md) — automated start, attach, join, assign, session socket, token move, reconnect snapshot, and cleanup smoke helper.
- [docs/live-session-lan-manual-smoke-results.md](docs/live-session-lan-manual-smoke-results.md) — recorded LAN browser-client smoke results for guarded startup, two-player join, session socket presence, reconnect, and cleanup.
- [docs/live-session-command-flow-maintenance.md](docs/live-session-command-flow-maintenance.md) — integrated multi-client command-flow coverage covering accepted commands, reconnect, permissions, and stale conflicts.
- [docs/live-session-concurrency-benchmark-notes.md](docs/live-session-concurrency-benchmark-notes.md) — expected LAN/named-tunnel concurrency behaviour, latency-sensitive paths, replay/snapshot fallback, and before-game smoke checks.
- [docs/live-session-implementation-maintenance.md](docs/live-session-implementation-maintenance.md) — implementation maintenance guide linking product docs, source areas, validation evidence, and known limitations.
- [docs/live-session-product-readiness-review.md](docs/live-session-product-readiness-review.md) — concise product/developer readiness review for architecture, table flow, validation, limits, and operator checks.
- [docs/live-session-readiness-summary.md](docs/live-session-readiness-summary.md) — product/developer readiness summary for validation, evidence links, and architecture confirmation.
- [docs/live-session-local-mode-maintenance.md](docs/live-session-local-mode-maintenance.md) — local-mode maintenance checks for plain map/sheet workflows, legacy SSE, and session-mode opt-in boundaries.
- [docs/live-session-quick-tunnel-caveat.md](docs/live-session-quick-tunnel-caveat.md) — Quick Tunnel caveats for temporary development smoke tests only, including legacy SSE limitations.
- [docs/live-session-multi-tab-smoke.md](docs/live-session-multi-tab-smoke.md) — local multi-tab helper for GM/player session-mode token propagation smoke checks.
- [docs/live-session-storage.md](docs/live-session-storage.md) — local session snapshot/event-log paths, privacy boundaries, backup guidance, and recovery limits.
- [docs/live-session-backup-recovery.md](docs/live-session-backup-recovery.md) — private session backup/restore runbook for snapshots, optional event logs, and referenced campaign data.
- [docs/live-session-persistence-recovery-maintenance.md](docs/live-session-persistence-recovery-maintenance.md) — persistence/recovery maintenance for snapshots, optional event logs, backup docs, cleanup, and local data hygiene.
- [docs/live-session-security-boundaries.md](docs/live-session-security-boundaries.md) — trust boundaries, join-code limits, tunnel exposure risks, non-hardened areas, and live session security non-goals.
- [docs/live-session-security-secret-hygiene-readiness.md](docs/live-session-security-secret-hygiene-readiness.md) — security and secret-hygiene readiness maintenance for auth/session/cookie/permission boundaries, public exposure warnings, committed-data hygiene, and remaining non-goals.
- [docs/live-session-dependency-runtime-maintenance.md](docs/live-session-dependency-runtime-maintenance.md) — live session dependency inventory, runtime flags, Node/Nitro compatibility, and Cloudflare tunnel assumptions.
- [docs/local-development.md](docs/local-development.md) — local setup, scripts, and filesystem persistence notes.
- [docs/fan-project-notice.md](docs/fan-project-notice.md) — fan project and ownership boundaries.

## Features

- **Isometric map table** — create map folders, edit maps, build voxel terrain, place hazards, manage field effects, spawn Pokémon and trainer tokens, move/turn tokens, track initiative, and use move/ability automation.
- **Sheet library** — create, organise, rename, edit, and autosave Pokémon and trainer sheets from the browser.
- **Pokédex browser** — search and filter Pokémon entries, view sprites and detail panes, and jump directly to Pokémon-specific pages.
- **Reference library** — browse moves, maneuvers, abilities, capabilities, conditions, rules, items, features, and edges.
- **Encounter tools** — manage JSON encounter tables, roll previews, and generate wild Pokémon sheets into the sheet library.
- **GM/player access modes** — GM-only routes and controls are hidden from the player role and checked on server routes; Player Login asks for a persistent player profile before continuing.
- **Filesystem-backed data** — maps, sheets, trainers, and encounter tables are stored as JSON in the repository tree for easy inspection, backup, and diffing.

## Suggested review path

### 5-minute reviewer path

1. Read the project positioning above and the fan/auth caveats.
2. Skim [docs/review-guide.md](docs/review-guide.md).
3. Inspect the route list in this README, then open `/maps`, `/sheets`, `/pokedex`, and `/generate` locally as GM.
4. Look at `src/pages/`, `src/components/map/`, `src/utils/isometric/`, `server/useCases/`, and `tests/` to see the product surface area.

### 15-minute reviewer path

1. Run `npm run typecheck`, `npm test`, and `npm run build`.
2. Review [docs/architecture.md](docs/architecture.md) and [docs/data-model.md](docs/data-model.md).
3. Trace one local-first workflow end-to-end: edit a sheet, place it on a map, save the map JSON, and inspect the corresponding `data/` file.
4. Trace one encounter workflow: inspect `encounter_tables/`, open `/encounter-tables`, then use `/generate` or `just encounter ... preview`.
5. Browse a few tests under `tests/server`, `tests/composables`, and `tests/utils` to see behaviour coverage around persistence, routing, and domain helpers.

### What the project demonstrates

- Product thinking around a real tabletop workflow instead of a thin demo.
- Frontend complexity: searchable libraries, editors, autosave, role-aware navigation, and dense control panels.
- Domain modelling for maps, sheets, trainers, move data, encounter tables, and app-owned PTU reference content.
- Local-first persistence with human-readable JSON and `.gitignore` boundaries for personal campaign data.
- Long-term ownership: broad test coverage, refactoring-oriented structure, and supporting documentation.

### Intentionally out of scope

- Hardened public authentication, accounts, permissions, or multi-tenant hosting.
- Cloud persistence or collaborative database infrastructure.
- Claiming official status, commercial distribution, or ownership of Pokémon/PTU names, images, or concepts.
- A generic virtual tabletop; this is specifically shaped around one PTU campaign workflow.

## Screenshots

No screenshot files are committed in this presentation pass. See [docs/screenshots.md](docs/screenshots.md) for the capture checklist to add later without inventing or linking missing images.

## Tech stack

- [Nuxt 3](https://nuxt.com/) and Vue 3
- TypeScript
- Vitest
- Three.js
- npm
- Optional Python/`just` helper scripts for PTU reference lookup and encounter generation

## Architecture at a glance

- `src/` contains the Nuxt app: pages, components, composables, assets, and browser-side utilities.
- `server/` contains Nitro API routes, use cases, and filesystem persistence helpers.
- `shared/` contains auth, path, realtime, sheet, and encounter helpers shared by app and server code.
- `data/` and `encounter_tables/` hold app-owned JSON/TypeScript data consumed at runtime; `ptu-data/` is documentary upstream/source material and parser tooling.
- `tests/` contains Vitest coverage across server use cases, composables, shared helpers, and domain utilities.

See [docs/architecture.md](docs/architecture.md) for more detail.

## Common routes

| Route | Purpose |
| --- | --- |
| `/` | Redirects to the map library. |
| `/login` | Choose the local GM role or select/create the persistent player profile for Player Login. |
| `/sessions` | Live session lobby for session hosting, GM start/manage, and player join flows. |
| `/player-profiles` | GM-only player profile list and linked-character review. |
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
| `data/maps/` | Saved map JSON and map-adjacent local files. |
| `data/sessions/` | Live session snapshots and optional event logs; ignored/private runtime data. |
| `data/sheets/` | Pokémon character-sheet JSON, including generated wild sheets. |
| `data/trainers/` | Trainer sheet JSON. |
| `encounter_tables/` | Encounter-table JSON, grouped by folder/region. |
| `data/reference/` | App-owned PTU reference JSON used by runtime pages, sheets, lookup helpers, and automation. |
| `books/markdown/` | Markdown source/reference content. |
| `ptu-data/` | Documentary upstream PTU parsing/source helpers; not the runtime source of truth. |
| `public/` | Public static assets. |
| `trainer_sizes/sprites/` | Trainer sprite assets served by Nitro at `/trainer-sprites`. |
| `src/` | Nuxt app source: pages, components, composables, assets, and utilities. |
| `server/` | Nitro API routes and filesystem persistence helpers. |
| `shared/` | Shared auth/path/sheet helpers used by both app and server. |
| `tests/` | Vitest coverage for shared logic, utilities, composables, and server helpers. |

Saved sheets and maps are edited by the app itself. Live session snapshots and optional event logs live under `data/sessions/` when session hosting is used. In development, Nuxt/Vite ignores changes under `data/sheets`, `data/trainers`, and `data/maps` so autosaves do not force a full page reload. `.gitignore` is configured to keep personal campaign data and session runtime files out of the repository while allowing curated examples to remain inspectable.

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Nuxt development server without enabling live session hosting. |
| `npm run dev:session:lan` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and LAN binding (`0.0.0.0:3000`). |
| `npm run dev:session:tunnel` | Start a guarded live session host with `ROTOM_ENABLE_SESSION_HOST=1` and loopback binding (`127.0.0.1:3000`) for a named tunnel. |
| `npm run build` | Build the Nuxt app. |
| `npm run preview` | Preview the built app. |
| `npm run typecheck` | Run Nuxt/Vue TypeScript checks. |
| `npm test` | Run the Vitest test suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run smoke:session:multi-tab` | Open/print local live session GM/player smoke URLs and run focused token/client smoke checks. |
| `npm run smoke:session:real-flow` | Exercise start, attach, join, assign, session socket token move, reconnect snapshot, and smoke cleanup against a running session host. |
| `npm run check:move-automation` | Check move automation coverage. |
| `npm run sync:item-sprites` | Sync item sprite assets. |
| `npm run refactor:loop` | Run the refactor loop helper script. |

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

- **GM** — full map, sheet, encounter, and control-panel access.
- **Player** — shared player view with player-visible maps and sheets.
- **Guest** — redirected to `/login`.

Server routes also check the session role for protected actions. Treat this as a local/campaign-table workflow, not a hardened public authentication system.

## Production notes

This project is strongest as a local development/table tool because many workflows persist JSON directly into the repository tree. Several mutating API routes are guarded against production mode, so use `npm run dev` when you need browser-based editing, autosave, encounter generation, or filesystem-backed management.

For a hosted deployment, decide which data should be static, which data should be persisted elsewhere, and whether to replace the trust-based role picker with real authentication.

## Portfolio framing

Rotom Table complements backend/platform repositories by showing a different set of engineering strengths: frontend/product complexity, UI state management, interactive graphics, typed domain modelling, data stewardship, and the maintenance habits required for a long-lived personal tool.

## Troubleshooting

**I am redirected to login.**  
Choose GM or Player on `/login`. The chosen role is stored in the `rotom-role` cookie.

**Browser edits are not visible immediately.**  
Most app pages update through local state and realtime events. If you generated or edited files outside the browser, refresh the page or restart the dev server.

**Write actions fail in production.**  
Run the app with `npm run dev`. Production mode intentionally disables several filesystem-mutating endpoints.

**Generated wild sheets do not show up.**  
Check that generated JSON files landed under `data/sheets/`, usually `data/sheets/wild/...`, and refresh the `/sheets` page.

## Contributing, security, and notices

- See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, checks, data hygiene, and fan-project boundaries.
- See [SECURITY.md](SECURITY.md) for local-first/trust-based security expectations and reporting guidance.
- See [NOTICE.md](NOTICE.md) and [docs/fan-project-notice.md](docs/fan-project-notice.md) for fan project and reuse boundaries.

## License

Original Rotom Table application code, project-specific documentation, and original tooling are available under the MIT License. See [LICENSE](LICENSE).

That license does not grant rights to Pokémon-related or PTU-related names, images, rules terms, concepts, sprites, reference text, or other third-party materials.

## Fan project notice

Rotom Table is a fan-made tabletop utility. Pokémon-related and PTU-related names, images, and concepts belong to their respective owners. This repository does not claim official affiliation, endorsement, or ownership of those materials.
