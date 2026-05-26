# Local development

Rotom Table is designed to run locally with filesystem-backed JSON data.

## Requirements

- Node.js and npm; a current LTS release is recommended.
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

Nuxt will print the local URL, usually `http://localhost:3000`. Open the app and choose **GM Login** or **Player Login**. The selected role is stored in the `rotom-role` cookie.

## Track 2 session lobby smoke testing

Session hosting is disabled by default. Plain `npm run dev` keeps Track 2 session endpoints and sockets fail-closed. Use the guarded helper that matches the smoke path:

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

See [Track 2 session host runtime scripts](track-2-session-host-runtime.md) for helper options, safe defaults, and shutdown notes. See [Track 2 public exposure checks](track-2-public-exposure-checks.md) for no-secret safety banner warnings around public/LAN startup before session-local credentials and authoritative state are ready. See [Track 2 LAN hosting runbook](track-2-lan-hosting.md) for same-Wi-Fi setup, IP discovery, player browser URLs, and troubleshooting. See [Track 2 named Cloudflare Tunnel runbook](track-2-cloudflare-tunnel-hosting.md) for stable-hostname remote setup, WebSocket considerations, safety warnings, and rollback steps. See [Track 2 deployment smoke checklist](track-2-deployment-smoke-checklist.md) for the two-player LAN/named-tunnel pass covering reconnect, token movement, initiative, and conflict rejection, and [Track 2 LAN manual smoke results](track-2-lan-manual-smoke-results.md) for the recorded ticket 091 browser-client LAN pass. See [Track 2 Quick Tunnel caveat](track-2-quick-tunnel-caveat.md) before using any temporary `trycloudflare.com` URL; Quick Tunnel is development smoke-test only and does not make legacy SSE a supported session transport. See [Track 2 security review](track-2-security-review.md) for trust boundaries, join-code limits, tunnel exposure risks, and non-hardened areas. See [Track 2 dependency and runtime review](track-2-dependency-runtime-review.md) for the reviewed package/runtime boundaries, exact session-host flag, Node/Nitro compatibility, and Cloudflare assumptions. See [Track 2 session lobby and manual QA](track-2-session-lobby.md) for the GM/player join flow, safety boundaries, and two-browser checklist. For the client-integration smoke that opens GM/player session-map tabs and checks basic token command propagation, use:

```bash
npm run smoke:session:multi-tab -- --map <map-slug>
```

The existing local GM/player picker remains a trust switch for local use, not public authentication.

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

Recommended local verification before sharing changes:

```bash
npm run typecheck
npm test
npm run build
```

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

Encounter generation without `preview` writes generated Pokémon sheets under `data/sheets/wild/<table>_<count>/` by default.

## Local data behaviour

The app edits local JSON files during development:

- maps: `data/maps/`
- Track 2 session snapshots and optional event logs: `data/sessions/`
- Pokémon sheets: `data/sheets/`
- trainer sheets: `data/trainers/`
- encounter tables: `encounter_tables/`

Nuxt/Vite are configured to ignore app-written sheet/map data changes so autosaves do not trigger full page reloads while editing. If you edit files outside the browser, refresh the relevant page or restart the dev server if the UI does not reflect the change.

`.gitignore` is configured to keep personal campaign data and Track 2 session runtime files out of the repository by default. Before committing, check `git status` and make sure private campaign data, real player details, session snapshots/event logs, credentials, and unreleased story notes are not included. See [Track 2 session storage](track-2-session-storage.md) for snapshot/event-log layout details, [Track 2 session backup and recovery](track-2-session-backup-recovery.md) for private archive/restore guidance, and [Track 2 security review](track-2-security-review.md) for no-secret data-handling boundaries.

## Production write limitations

Rotom Table is strongest as a local table tool. Several filesystem-mutating API routes are disabled in production mode. Use `npm run dev` when you need browser-based editing, autosave, encounter generation, or local JSON management.

A hosted/public deployment should replace the trust-based role picker, decide on a durable persistence layer, review asset/content rights, and separate private campaign data from public reference data.
