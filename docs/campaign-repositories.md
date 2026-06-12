# Campaign repositories

Rotom Table can keep private campaign JSON and campaign-owned reference override diffs in a separate repository from the application checkout. Set `ROTOM_CAMPAIGN_ROOT` to the campaign workspace before starting Nuxt.

```bash
ROTOM_CAMPAIGN_ROOT=/home/me/campaigns/helix npm run dev
```

Relative paths are resolved from the app checkout, and `~/...` expands to your home directory, so this also works:

```bash
ROTOM_CAMPAIGN_ROOT=../helix-campaign npm run dev
```

With the variable set, Rotom Table reads and writes campaign-owned files under that root:

| Campaign path | Used for |
| --- | --- |
| `data/maps/` | Saved map JSON. |
| `data/sheets/` | Pokémon sheet JSON and generated wild sheets. |
| `data/trainers/` | Trainer sheet JSON. |
| `data/player-profiles/` | Local player profile JSON. |
| `data/reference-overrides/` | Campaign-owned reference override diffs, currently Pokédex maintenance entries. |
| `encounter_tables/` | Encounter-table JSON. |
| `rotom-table.sqlite` | SQLite database for command-backed live-play maps, sheets, and operation results as routes migrate to database repositories. |
| `rotom-table.sqlite-wal`, `rotom-table.sqlite-shm` | SQLite WAL sidecar files when the database is open in WAL mode. |

App-owned PTU reference data stays in the app repo under `data/reference/`. GM Pokédex maintenance writes a campaign override diff at `data/reference-overrides/pokedex.json` instead of rewriting the app-owned `data/reference/pokedex.json` file. The override file stores replacement Pokédex entries keyed by the original app-reference slug; when a saved entry matches the app reference again, its campaign override is removed from the diff.

The default live-play database path is `${ROTOM_CAMPAIGN_ROOT}/rotom-table.sqlite`. Set `ROTOM_DB_PATH` only when the database should live at a different operator-controlled path; relative `ROTOM_DB_PATH` values are resolved under `ROTOM_CAMPAIGN_ROOT`.

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
      player-profiles/
      reference-overrides/
    encounter_tables/
  backups/                # private backup archives or restore staging, not Git
```

Use the campaign directory as the configured root:

```bash
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign
```

With that setting, Rotom Table reads and writes maps under `/srv/rotom-table/campaign/data/maps/`, Pokémon sheets under `/srv/rotom-table/campaign/data/sheets/`, trainer sheets under `/srv/rotom-table/campaign/data/trainers/`, player profiles under `/srv/rotom-table/campaign/data/player-profiles/`, campaign reference overrides under `/srv/rotom-table/campaign/data/reference-overrides/`, and encounter tables under `/srv/rotom-table/campaign/encounter_tables/`.

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

Commit and push JSON campaign material normally with Git when that fits your private workflow. Treat live SQLite database files as runtime state: prefer private backups or explicit export/migration artifacts over committing the database and WAL sidecars directly. Existing map JSON can be imported into the live-play database through the server-side `server/storage/importMapsFromJson.ts` helper; existing Pokémon/trainer sheet JSON can be imported through `server/storage/importSheetsFromJson.ts`. Both importers are repeatable, preserve revisions, report source folders, and leave the source JSON files in place. Rotom Table does not run Git operations itself; it only reads and writes files in the configured campaign root.

## Notes

- Restart Nuxt after changing `ROTOM_CAMPAIGN_ROOT`; the paths are resolved when server modules load.
- `scripts/roll.py` and `just encounter` also respect `ROTOM_CAMPAIGN_ROOT`.
- If the variable is unset, Rotom Table uses the app checkout as the campaign root for local development.
