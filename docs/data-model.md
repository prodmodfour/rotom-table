# Data model

Rotom Table is built around local, inspectable data. The app edits JSON in the repository tree during local development so campaign data can be backed up, reviewed in Git, and repaired manually when needed.

## Maps

Maps live under `data/maps/` as JSON documents.

A map stores the state the tabletop needs to render and run a scene:

- identity: slug, name, optional folder, timestamps, and metadata
- dimensions and ground-level information
- sparse terrain voxels with material IDs and optional colour/blocking overrides
- token placements linked to Pokémon or trainer sheets by `sheetKind` and `sheetSlug`
- player visibility flags
- battlefield hazards such as Spikes, Toxic Spikes, Sticky Web, Stealth Rock, and Fire
- field effects such as weather, terrain, and rooms
- light placements
- initiative round/current-turn state

The map renderer and map editor treat the JSON document as the source of truth for the local table. During player play, token control is derived from the selected player profile: a player can act with placements whose `sheetKind` and `sheetSlug` match a linked character sheet on that profile.

## Sheets

Pokémon sheets live under `data/sheets/` as JSON documents.

A Pokémon sheet models the PTU creature sheet while allowing most fields to remain optional. The app can derive defaults from species/reference data and layer campaign-specific edits on top. Common areas include:

- slug, nickname, species, level, gender, shiny flag, and player visibility
- nature, types, egg groups, and stat allocations
- HP, injuries, evasion, conditions, and combat stages
- held items, tutor points, skill background, capabilities, skills, abilities, edges, and movelist entries
- free-form campaign notes and scene/experience fields

Generated or curated examples can live in subfolders, and generated wild sheets normally use `data/sheets/wild/...`.

## Trainers

Trainer sheets live under `data/trainers/` as JSON documents.

Trainer sheets model a PTU trainer workbook: core trainer identity, stats, skills, AP, features, edges, classes, combat capabilities, movelist, orders, inventory, equipment, Pokémon links, portrait/sprite data, and campaign notes. Like Pokémon sheets, most fields are optional so the UI can render a new sheet from a small starting document.

## Player profiles

Persistent player profiles live under `data/player-profiles/` as private campaign JSON.

A profile stores a stable local profile ID, a display name, a schema version, and linked character refs. Linked character refs point at existing Pokémon or trainer sheets by `sheetKind` and `sheetSlug`; they do not copy sheet data into the profile.

The selected player profile is the source of player-specific control:

- linked sheets can be loaded and saved by that player through normal sheet editors;
- matching map token placements can be moved, turned, and used for token-scoped table actions;
- unrelated private sheets and unlinked map tokens remain outside that player's control.

See [Player profiles and linked character control](player-profiles.md) for the product flow.

## Encounter tables

Encounter tables live under `encounter_tables/<region>/<table>.json`.

A table includes:

- a display name
- an inclusive minimum and maximum level
- weighted entries with species and optional per-entry level bounds

The browser `/encounter-tables` editor and the optional terminal `just encounter` workflow operate on these same JSON files. This keeps encounter design inspectable and reusable.

## App-owned PTU reference content

Runtime PTU reference data is app-owned and stored under `data/reference/`. Treat this content as authoritative for Rotom Table's PTU implementation, including deliberate differences introduced by the 3D tabletop model. The `ptu-data/` tree remains useful as documentary upstream/source material and parser output, but the app should not depend on it as the runtime source of truth.

Important reference files include:

- `data/reference/abilities.json`
- `data/reference/capabilities.json`
- `data/reference/conditions.json`
- `data/reference/edges.json`
- `data/reference/features.json`
- `data/reference/items.json`
- `data/reference/maneuvers.json`
- `data/reference/moves.json`
- `data/reference/pokedex.json`
- `data/reference/rules.json`

The app uses this content for Pokédex browsing, reference pages, sheet defaults, lookup helpers, and automation support.

## Generated wild sheets

Encounter generation writes Pokémon sheets into `data/sheets/wild/<table>_<count>/` by default. Those files then appear in the `/sheets` page like other Pokémon sheets.

Use preview mode when you want to test an encounter roll without keeping generated files:

```bash
just encounter <region> <table> <count> preview
```

The browser `/generate` page can also preview or write generated results depending on the workflow.

## Local campaign data and `.gitignore`

The repository is configured for local campaign ownership:

- personal maps, player profiles, sheets, trainer files, legacy live session snapshots, and optional event logs should not be committed by default
- curated example sheets can remain trackable for review/demo purposes
- generated wild sheets should be reviewed before committing, if they are ever meant to be examples
- JSON should stay readable and inspectable rather than hidden behind opaque binary formats

Before publishing or sharing a branch, check `git status` and make sure private campaign notes, player profile data, player information, unreleased story material, session files, and one-off local data are not included. See [Player profiles and linked character control](player-profiles.md) for current profile behaviour and [live session storage](live-session-storage.md) for legacy session snapshot/event-log backup and recovery guidance.
