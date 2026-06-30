# Campaign repositories

Rotom Table can keep private campaign SQLite state, maintenance JSON, and campaign-owned reference override diffs in a separate repository from the application checkout. Set `ROTOM_CAMPAIGN_ROOT` to the campaign workspace before starting Nuxt.

```bash
ROTOM_CAMPAIGN_ROOT=/home/me/campaigns/helix npm run dev
```

Relative paths are resolved from the app checkout, and `~/...` expands to your home directory, so this also works:

```bash
ROTOM_CAMPAIGN_ROOT=../helix-campaign npm run dev
```

With the variable set, Rotom Table resolves campaign-owned state under that root:

| Campaign path | Used for |
| --- | --- |
| `data/maps/` | Legacy map JSON import/export hierarchy; not runtime authority. |
| `data/sheets/` | Legacy Pokémon sheet JSON import/export hierarchy; not runtime authority. |
| `data/trainers/` | Legacy trainer sheet JSON import/export hierarchy; not runtime authority. |
| `data/group-inventories/` | Legacy group inventory JSON import/export hierarchy; not runtime authority. |
| `data/player-profiles/` | Local player profile JSON. |
| `data/reference-overrides/` | Campaign-owned reference override diffs, currently Pokédex maintenance entries. |
| `encounter_tables/` | Encounter-table JSON. |
| `rotom-table.sqlite` | SQLite database and sole runtime authority for maps, map folders, Pokémon/trainer sheets, sheet folders, interaction modes, and live-play operation results. |
| `rotom-table.sqlite-wal`, `rotom-table.sqlite-shm` | SQLite WAL sidecar files when the database is open in WAL mode. |

App-owned PTU reference data stays in the app repo under `data/reference/`. GM Pokédex maintenance writes a campaign override diff at `data/reference-overrides/pokedex.json` instead of rewriting the app-owned `data/reference/pokedex.json` file. The override file stores replacement Pokédex entries keyed by the original app-reference slug; when a saved entry matches the app reference again, its campaign override is removed from the diff.

The default live-play database path is `${ROTOM_CAMPAIGN_ROOT}/rotom-table.sqlite`. Set `ROTOM_DB_PATH` only when the database should live at a different private operator-controlled campaign-storage path outside the app checkout and included in backups; relative `ROTOM_DB_PATH` values are resolved under `ROTOM_CAMPAIGN_ROOT`.

## Private VPS layout example

For a private VPS, keep the application checkout, campaign root, and backups separated even when they share one operator-controlled parent directory:

```text
/srv/rotom-table/
  app/                    # application checkout and built .output/ server
  campaign/               # ROTOM_CAMPAIGN_ROOT; private campaign JSON and reference override diffs
    data/
      maps/
      sheets/
      trainers/
      group-inventories/
      player-profiles/
      reference-overrides/
    encounter_tables/
  backups/                # private backup archives or restore staging, not Git
```

Use the campaign directory as the configured root:

```bash
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign
```

With that setting, Rotom Table reads and writes runtime maps/sheets/group inventory in `/srv/rotom-table/campaign/rotom-table.sqlite`, player profiles under `/srv/rotom-table/campaign/data/player-profiles/`, campaign reference overrides under `/srv/rotom-table/campaign/data/reference-overrides/`, and encounter tables under `/srv/rotom-table/campaign/encounter_tables/`. Map/sheet/group-inventory JSON directories are used only by explicit import/export maintenance tooling.

Do not put private campaign JSON, campaign-specific reference overrides, player profile data, backup archives, unreleased notes, or real environment files in the app checkout at `/srv/rotom-table/app`, especially if that checkout is pushed to a public or shared Git repository.

## Suggested campaign repo layout

```txt
my-campaign/
  data/
    maps/
    sheets/
    trainers/
    player-profiles/
    reference-overrides/
  encounter_tables/
  assets/
  .gitignore
```

Suggested campaign `.gitignore`:

```gitignore
.env
.env.*
temp/
*.tmp
*.sqlite
*.sqlite-wal
*.sqlite-shm
*.db
*.db-wal
*.db-shm
.DS_Store
```

Commit and push remaining JSON campaign material normally with Git when that fits your private workflow. Treat SQLite database files as runtime state: prefer private backups or explicit export artifacts over committing the database and WAL sidecars directly. Existing map JSON, Pokémon sheet JSON, trainer sheet JSON, and exported group inventory JSON can be imported into SQLite with `ROTOM_CAMPAIGN_ROOT=/path/to/campaign npm run migrate:sqlite -- --backup-root /path/to/private/backups`. The command creates a pre-migration backup, validates JSON-backed player profiles, preserves revisions and folders, restores exported group inventory documents with revisions and timestamps, leaves source JSON files in place, reports imported and skipped rows, and is safe to rerun. Runtime export uses `npm run export:sqlite-json -- --output /safe/export/path`, which writes group inventory documents under `data/group-inventories/`. Rotom Table does not run Git operations itself; runtime map/sheet/group-inventory APIs read and write SQLite.

## Notes

- Restart Nuxt after changing `ROTOM_CAMPAIGN_ROOT`; the paths are resolved when server modules load.
- `scripts/roll.py` and `just encounter` also respect `ROTOM_CAMPAIGN_ROOT`.
- If the variable is unset, Rotom Table uses the app checkout as the campaign root for local development.
