# Source-tree and private-data hygiene

The tagged Rotom Table source repository is public code and documentation, not campaign storage. The supported private VPS keeps campaign authority under an operator-controlled `ROTOM_CAMPAIGN_ROOT` outside the checkout.

## Clean-clone setup

```bash
git clone https://github.com/prodmodfour/rotom-table.git
cd rotom-table
nvm use
npm ci --include=dev
npm run check:release-readiness:private-artifacts
```

A clean clone contains no campaign database, profile, environment file, backup, release evidence, Playwright result, or operator log. `npm ci --include=dev` creates ignored source-build dependencies and Nuxt preparation output; it must not create tracked campaign authority.

## Keep these outside Git

- SQLite databases, WAL/SHM sidecars, and database copies;
- `.env` and production environment files, credentials, signing keys, and certificates;
- maps, sheets, Trainers, player profiles, reference overrides, group inventories, shops, session state, and current encounter tables;
- backup archives, restore staging roots, logs, PID/run state, and release evidence;
- Playwright reports, traces, screenshots containing table content, and temporary workspaces.

Use a sibling or absolute private root, for example:

```bash
sudo install -d -m 0750 -o rotom-table -g rotom-table /srv/rotom-table/campaign
ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign npm run audit:campaign -- --database /srv/rotom-table/campaign/rotom-table.sqlite
```

Never copy that private root into the repository. Release backup archives belong under the operator’s private backup root, not beside source files.

## Intentional tracked exceptions

- `.env.example` and `.env.vps.example` contain placeholders only.
- `data/sheets/examples/` contains reviewed generated examples.
- Four JSON files under `encounter_tables/` are frozen, owner-retained legacy migration fixtures; `encounter_tables/README.md` labels their boundary.
- `books/`, `ptu-data/`, and `trainer_sizes/` are retained and labelled by the P13-058 owner disposition. They must not receive private campaign additions.
- `docs/screenshots/` contains hash-bound screenshots captured from a fresh synthetic campaign root.

## Before every commit or release

```bash
git status --short
bash scripts/check-no-generated-private-files.sh
bash scripts/check-no-secrets.sh
npm run check:release-readiness:private-artifacts
```

Inspect every newly tracked data or image file. If a required private path is not ignored, stop, extend `.gitignore` and the registered audit probes, remove the file from Git’s index, and rotate any exposed credential. Do not merely delete a secret in a later commit; treat Git history as disclosed.
