# Campaign repositories

Rotom Table can keep private campaign JSON in a separate repository from the application checkout. Set `ROTOM_CAMPAIGN_ROOT` to the campaign workspace before starting Nuxt.

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
| `encounter_tables/` | Encounter-table JSON. |

App-owned PTU reference data stays in the app repo under `data/reference/`.

## Private VPS layout example

For a private VPS, keep the application checkout, campaign root, and backups separated even when they share one operator-controlled parent directory:

```text
/srv/rotom-table/
  app/                    # application checkout and built .output/ server
  campaign/               # ROTOM_CAMPAIGN_ROOT; private campaign JSON only
    data/
      maps/
      sheets/
      trainers/
      player-profiles/
    encounter_tables/
  backups/                # private backup archives or restore staging, not Git
```

Use the campaign directory as the configured root:

```bash
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign
```

With that setting, Rotom Table reads and writes maps under `/srv/rotom-table/campaign/data/maps/`, Pokémon sheets under `/srv/rotom-table/campaign/data/sheets/`, trainer sheets under `/srv/rotom-table/campaign/data/trainers/`, player profiles under `/srv/rotom-table/campaign/data/player-profiles/`, and encounter tables under `/srv/rotom-table/campaign/encounter_tables/`.

Do not put private campaign JSON, player profile data, backup archives, unreleased notes, or real environment files in the app checkout at `/srv/rotom-table/app`, especially if that checkout is pushed to a public or shared Git repository.

## Suggested campaign repo layout

```txt
my-campaign/
  data/
    maps/
    sheets/
    trainers/
    player-profiles/
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
.DS_Store
```

Commit and push the campaign repo normally with Git. Rotom Table does not run Git operations itself; it only reads and writes the JSON files in the configured campaign root.

## Notes

- Restart Nuxt after changing `ROTOM_CAMPAIGN_ROOT`; the paths are resolved when server modules load.
- `scripts/roll.py` and `just encounter` also respect `ROTOM_CAMPAIGN_ROOT`.
- If the variable is unset, Rotom Table keeps the existing local-first behavior and uses the app checkout as the campaign root.
