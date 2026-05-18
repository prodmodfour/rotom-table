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
- Pokémon sheets: `data/sheets/`
- trainer sheets: `data/trainers/`
- encounter tables: `encounter_tables/`

Nuxt/Vite are configured to ignore app-written sheet/map data changes so autosaves do not trigger full page reloads while editing. If you edit files outside the browser, refresh the relevant page or restart the dev server if the UI does not reflect the change.

`.gitignore` is configured to keep personal campaign data out of the repository by default. Before committing, check `git status` and make sure private campaign data, real player details, credentials, and unreleased story notes are not included.

## Production write limitations

Rotom Table is strongest as a local table tool. Several filesystem-mutating API routes are disabled in production mode. Use `npm run dev` when you need browser-based editing, autosave, encounter generation, or local JSON management.

A hosted/public deployment should replace the trust-based role picker, decide on a durable persistence layer, review asset/content rights, and separate private campaign data from public reference data.
