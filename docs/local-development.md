# Local development

Rotom Table runs locally with SQLite-backed runtime maps/sheets and remaining inspectable JSON maintenance data.

## Requirements

- Node.js 24 LTS and npm.
- Optional: Python 3 for helper scripts in `scripts/` and `ptu-data/`.
- Optional: [`just`](https://github.com/casey/just) for convenience commands in `justfile`.

## Install

```bash
npm install
```

## Run the app

```bash
npm run dev
```

Nuxt will print the local URL, usually `http://localhost:3000`. Open the app and choose **GM Login** or **Player Login**. The selected role is stored in the `rotom-role` cookie. Player Login then opens the persistent player profile picker for this browser.

## Profile play and legacy live-session hosting

Plain `npm run dev` is the standard local development path. Map and sheet routes such as `/maps/<slug>`, `/sheets/<slug>`, and `/sheets/trainers/<slug>` save runtime SQLite documents through revision-checked autosave for setup/edit workflows. Whole-map map saves are GM setup/edit-only and require the setup/edit interaction mode; they are not accepted from Player Login or from live-play mode. Those document saves and legacy `/api/events` realtime updates are not the authority model for live multiplayer gameplay.

Normal map play uses the saved map document at `/maps/<slug>` with profile-linked token control. GMs manage profile links at `/players`; players select a profile after Player Login, then navigate to the relevant player-visible map and act with linked characters. Live gameplay mutations move through server-authoritative command boundaries with revisions and idempotent `opId` handling; browser-owned whole-map autosave must not be used as the multiplayer strategy. Players can also browse Pokédex, sheet-library, and PTU reference routes without joining a live session.

Legacy live-session hosting remains behind `ROTOM_ENABLE_SESSION_HOST=1` for direct-only session lobby/socket maintenance, but the map-attachment endpoint and session-owned normal map path have been removed. Normal play no longer requires `/sessions`, a join code, attaching a saved map, or a special session query on map URLs. See [Player profiles and linked character control](player-profiles.md) for the current product flow.

For the automated and source-level no-regression evidence around setup/edit map autosave, sheet autosave, legacy `/api/events` sync, and non-session navigation, see the [Live session local-mode maintenance checks](archive/live-session/live-session-local-mode-maintenance.md). See [Live play authority](live-play-authority.md) for the normal command/revision direction.

## Legacy live session lobby smoke testing

The legacy session lobby is a direct-only maintenance/smoke surface, not a normal play requirement. Session hosting is disabled by default. Plain `npm run dev` keeps live session endpoints and sockets fail-closed. Use the guarded helper that matches the smoke path:

```bash
npm run dev:session:lan
```

LAN mode sets `ROTOM_ENABLE_SESSION_HOST=1` for the Nuxt child process and binds to `0.0.0.0:3000` so players on the same trusted private network can open the GM machine's URL. For a named Cloudflare Tunnel smoke, prefer loopback binding:

```bash
npm run dev:session:tunnel
```

The manual LAN equivalent remains:

```bash
ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000
```

See [live session host runtime scripts](archive/live-session/live-session-host-runtime.md) for helper options, safe defaults, and shutdown notes. See [Live session public exposure checks](archive/live-session/live-session-public-exposure-checks.md) for no-secret safety banner warnings around public/LAN startup before session-local credentials and authoritative state are ready. See [Live session LAN hosting runbook](archive/live-session/live-session-lan-hosting.md), [Live session named Cloudflare Tunnel runbook](archive/live-session/live-session-cloudflare-tunnel-hosting.md), and [Live session deployment smoke checklist](archive/live-session/live-session-deployment-smoke-checklist.md) only when maintaining the legacy lobby/socket surfaces; they are not instructions for normal profile-based play. See [Live session Quick Tunnel caveat](archive/live-session/live-session-quick-tunnel-caveat.md), [Live session security boundaries](archive/live-session/live-session-security-boundaries.md), and [Live session dependency and runtime maintenance](archive/live-session/live-session-dependency-runtime-maintenance.md) for the checked legacy boundaries. See [live session lobby and manual QA](archive/live-session/live-session-lobby.md) for the direct-only legacy lobby checklist.

The existing local GM/player picker remains a trust switch for local use, not public authentication. For the maintenance checks for plain `npm run dev`, `/maps/<slug>`, setup/edit sheet autosave, profile-linked control, and legacy SSE local-mode behaviour, see the [Live session local-mode maintenance checks](archive/live-session/live-session-local-mode-maintenance.md).

## Checks

Run TypeScript/Nuxt checks:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Build the app:

```bash
npm run build
```

Start the built Nitro server after a successful build when you need a production-style Node/Nitro smoke check or a private Node host process:

```bash
npm run start
```

In another shell, the no-secret health endpoint should return a small JSON status for private host or reverse-proxy monitoring:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

Recommended local verification before sharing changes:

```bash
npm run typecheck
npm test
npm run build
```

For a local workspace that more closely mirrors the private Ranger VPS process style (`NODE_ENV=production`, loopback Nitro binding, external campaign root, hosted-write opt-in, `npm run start` after build), use the checked-in tools under [`deploy/local-prodlike/`](../deploy/local-prodlike/). They keep campaign data, backups, logs, and env files outside the app checkout by default.

## Optional `just` commands

If `just` is installed, run:

```bash
just
```

to list available helper commands.

Common examples:

```bash
just pokemon "Pikachu"
just move "Thunderbolt"
just ability "Static"
just encounter
just encounter <region>
just encounter <region> <table> <count> preview
```

Encounter spawn flows persist generated Pokémon sheets into SQLite. Standalone encounter generation can still produce JSON output as explicit generation/interchange tooling, resolved under `ROTOM_CAMPAIGN_ROOT` when that variable is set.

## Local data behaviour

The app edits the local SQLite database for runtime maps and sheets during development. By default the campaign root is the app checkout; set `ROTOM_CAMPAIGN_ROOT=/path/to/private-campaign-repo` before `npm run dev` to resolve the database and remaining campaign-owned paths under a separate campaign repository instead. See [Campaign repositories](campaign-repositories.md).

- runtime maps/sheets/folders/modes: `rotom-table.sqlite` (or `ROTOM_DB_PATH`)
- map/sheet JSON import/export artifacts: `data/maps/`, `data/sheets/`, `data/trainers/`
- player profiles: `data/player-profiles/`
- Pokédex reference override diff: `data/reference-overrides/pokedex.json`
- encounter tables: `encounter_tables/`

Legacy session runtime files, if that maintenance surface is used, remain app-local under `data/sessions/` and are not part of the campaign repository root switch.

Nuxt/Vite are configured to ignore app-written maintenance data changes so admin edits do not trigger full page reloads while editing. If you edit the SQLite database or maintenance files outside the browser, refresh the relevant page or restart the dev server if the UI does not reflect the change. Restart Nuxt after changing `ROTOM_CAMPAIGN_ROOT`.

`.gitignore` is configured to keep personal campaign data, player profiles, campaign-specific reference overrides, new local encounter-table folders, and legacy live session runtime files out of the repository by default. Before committing, check `git status` and make sure private campaign data, real player details, session snapshots/event logs, credentials, and unreleased story notes are not included. See [Player profiles and linked character control](player-profiles.md) for profile behaviour, [live session storage](archive/live-session/live-session-storage.md) for legacy snapshot/event-log layout details, [Live session backup and recovery](archive/live-session/live-session-backup-recovery.md) for private archive/restore guidance, [Live session persistence/recovery maintenance](archive/live-session/live-session-persistence-recovery-maintenance.md) for the snapshot/event-log and hygiene review, and [Live session security boundaries](archive/live-session/live-session-security-boundaries.md) for no-secret data-handling boundaries.

## Production write limitations

Rotom Table is strongest as a local-development and private trusted-table tool. Production hosted writes are fail-closed unless a private operator explicitly opts in. Use `npm run dev` when you need unrestricted local browser editing, autosave, encounter generation, or filesystem JSON management.

The private VPS hosted-write policy uses `ROTOM_ENABLE_HOSTED_WRITES=1` as the exact production opt-in for covered campaign writes, including SQLite map/sheet writes and remaining maintenance JSON writes. When `NODE_ENV=production`, an unset flag or any value other than exactly `1` keeps covered hosted writes disabled with a 403-style error; non-production development writes remain unchanged. See [Private VPS hosting scope](private-vps-hosting.md) for the full flag semantics and private trusted-table boundary, and see the [API route mutation audit](api-route-mutation-audit.md) for route-by-route coverage.

A public deployment should replace the trust-based role picker, decide on a durable persistence layer, review mutating routes, review asset/content rights, and separate private campaign data from public reference data.
