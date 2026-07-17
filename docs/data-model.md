# Data model

Rotom Table stores runtime campaign maps, Pokémon/trainer sheets, shared group inventory, and shop tables in SQLite while keeping remaining campaign JSON systems inspectable. Set `ROTOM_CAMPAIGN_ROOT` to point campaign-owned paths and the default `rotom-table.sqlite` database at a separate private campaign repository or private host directory; see [Campaign repositories](campaign-repositories.md).

## Maps

Maps live as SQLite documents in the `maps` table. `data/maps/` is now an explicit import/export hierarchy, not runtime authority.

A map stores the state the tabletop needs to render and run a scene:

- identity: slug, name, optional folder, timestamps, and metadata
- dimensions and ground-level information
- sparse terrain voxels with material IDs and optional colour/blocking overrides
- token placements linked to Pokémon or trainer sheets by `sheetKind` and `sheetSlug`
- player visibility flags
- shop interface access points that reference authoritative shop table slugs without storing catalog, prices, or stock
- battlefield hazards such as Spikes, Toxic Spikes, Sticky Web, Stealth Rock, and Fire
- bounded map-ground item stacks created by authoritative drop, throw, and knock-off operations
- field effects such as weather, terrain, and rooms
- light placements
- initiative round/current-turn state

The map renderer and map editor treat the SQLite document as the source of truth for table play in both Prepare Map and Run Live Play. During player play, token control is derived from the selected player profile: a player can act with placements whose `sheetKind` and `sheetSlug` match a linked character sheet on that profile.

## Pending move resolutions

A MoveSpec execution suspended for an authorized choice or reaction is stored in `pending_move_resolutions`, separately from terminal command results in `live_play_ops`. Each row contains canonical strictly parsed resolution JSON plus indexed status, originating map and operation identity, a repository CAS revision, creation/update timestamps, and an optional link to the eventual terminal operation. Resolution IDs are primary keys and each originating map/operation pair is unique; declaration orchestration derives the ID from the exact command hash, so same-body retries resolve the existing row while changed material under the same `opId` conflicts. The private row, its bounded encounter-state summary, any explicitly typed pay-phase declaration HP cost, and reviewed encounter-resource spends through the reached phase commit atomically after full read-set validation; later-window spends are folded into the durable declaration compensation plan. The non-terminal pending acknowledgement is not a `live_play_ops` terminal. Continuation kinds distinguish suspended MoveSpec execution, reviewed ability follow-ups, and current post-action Attack of Opportunity responses. The private durable record owns resource reads, rolls, audit trace, response ownership, and stable option IDs; map encounter state exposes only its bounded public summary/ID. A movement option may carry a strict server-issued `movement-destination` or `movement-direction` selection (set ID, bounded destination, and reviewed direction where applicable). That typed selection is available only through the authorized response query for battlefield targeting, is never copied into the response command, and is regenerated/revalidated by the movement oracle on resume.

## Accepted move compensation

Terminal move rows in `live_play_ops` may carry private `move_compensation_json` beside—not inside—the public command `result_json`. The strict result identifies the originating map/operation and stores bounded typed entries for safely reversible state changes. An available entry records its stable inverse ID, source operation, exact resource revision before and after acceptance, expected current typed value, and restore value. Sheet entries contain only the changed HP, condition, combat-stage, or move-usage value; they never retain a generic private sheet snapshot. Encounter-state entries are projected per typed container, with history and terminal pending-summary transitions kept unavailable rather than restoring an encounter envelope. Non-reversible entries name an explicit irreversible or externally-observed reason. The column is server-only correction input and is omitted from HTTP/SSE/replay/status command results.

A GM correction submits only the accepted origin `opId` and selected stable inverse IDs. The server resolves those IDs against `move_compensation_json`, re-reads every affected resource, and requires both the recorded post-move revision and typed current value before applying anything. The map audit revision, corrected map/sheet documents, terminal correction operation, sheet events, and accepted realtime event commit together. Each correction row stores `correction_origin_op_id`, indexed back to the accepted source row; its public `move.correction` patch contains that ancestry, selected IDs, changed resource revisions, map-visible state lanes, and sheet references but no private sheet values or inverse payloads. A changed value or revision conflicts rather than restoring over later play, and exact duplicate correction `opId` delivery returns the stored result without another mutation.

## Sheets

Pokémon sheets live as SQLite documents keyed by `kind='pokemon'` and slug. `data/sheets/` is now an explicit import/export hierarchy, not runtime authority.

A Pokémon sheet models the PTU creature sheet while allowing most fields to remain optional. The app can derive defaults from species/reference data and layer campaign-specific edits on top. Common areas include:

- slug, nickname, species, level, gender, shiny flag, and player visibility
- nature, types, egg groups, and stat allocations
- HP, injuries, evasion, conditions, and combat stages
- held items, tutor points, skill background, capabilities, skills, abilities, edges, and movelist entries
- free-form campaign notes and scene/experience fields

Folders are logical SQLite folder rows plus document `folder` fields, so empty and nested folders survive restarts without filesystem directories.

## Trainers

Trainer sheets live as SQLite documents keyed by `kind='trainer'` and slug. `data/trainers/` is now an explicit import/export hierarchy, not runtime authority.

Trainer sheets model a PTU trainer workbook: core trainer identity, stats, skills, AP, features, edges, classes, combat capabilities, movelist, orders, inventory, equipment, Pokémon links, portrait/sprite data, and campaign notes. Like Pokémon sheets, most fields are optional so the UI can render a new sheet from a small starting document.

## Group inventory

The shared party inventory is campaign-level SQLite state in the `group_inventories` table, not map metadata and not a fake trainer sheet. The `/group-inventory` page loads the authoritative `main` document through the group inventory load API, renders campaign money, section counts, notes, and normalized trainer-inventory-style sections, and lets GMs directly edit money and item rows through a revision-checked save API. The same page exposes trainer transfer controls that wait for server acceptance before changing local state. Transfer APIs move item quantities atomically between the group inventory and trainer sheets: GMs can transfer with any trainer, while player requests must include the selected player profile ID and that profile must link the source or target trainer sheet. Players still cannot perform direct full-document group inventory saves. See [Group inventory workflow](group-inventory.md) for realtime, export, trusted-table, and future live-play command boundaries.

## Move item identities

Move automation addresses item state through the strict shared item-reference contract, never by a display name. A reference identifies one Pokémon held item, trainer equipment slot, trainer inventory row, group inventory row, or map-ground item by a stable item ID and canonical rules ID, together with the exact owning sheet, group-inventory document, or map revision. The reference also states authoritative quantity, singleton/stackable behavior, and equipped/unequipped semantics; incompatible owner, stack, quantity, or equipment combinations reject during parsing.

Map-ground items are persisted in the map's versioned `encounterState.groundItems` collection. Each bounded record stores a stable map-local ID, canonical item ID and name, quantity, integer cell/height, exact source resource revision, source operation ID, and nullable side/previous-placement hints. Those hints are provenance and presentation only: they do not grant control or replace map ownership. Normalization rejects duplicate IDs, malformed or oversized payloads, unknown side hints, and positions outside map bounds. The isometric scene renders a generic selectable marker and exposes only its stable ID through pointer interaction; later item-choice and mutation tickets remain responsible for authorization and state changes.

## Shop tables

Reusable shop tables are campaign-level SQLite state in the `shop_tables` table. Map `shopInterfaces[]` entries only reference a shop by slug and may store a map-local label/position/range/visibility; they do not own the item catalog, prices, stock, or open/closed state. The current shop APIs let GMs create, save, delete, list, and load authoritative shop documents with revisions and timestamps; player read routes only expose shops that are both open and player-visible. The `/shops` player library renders those open player-visible shopfronts as links to `/shops/<slug>` and omits closed or hidden shops instead of presenting disabled private setup rows. The `/shops/<slug>` shopfront loads the same authoritative document, renders item names, prices, stock, max-per-purchase limits, and player descriptions, redacts GM notes, and lets GMs or players set cart quantities before dispatching checkout through the live-play command outbox. Player trainer payment/delivery selectors are limited to trainer sheets linked to the selected player profile, and group inventory payment/delivery appears only when the shop allows that source or target. Server checkout dispatch is exposed only as `POST /api/shops/checkout` with a full `shopCheckout` live-play command envelope plus the existing `clientId`/player `profileId` route context; plain non-command checkout payloads are rejected. Checkout operation history lives in `shop_checkout_ops` with `op_id`, `shop_slug`, command JSON/hash, terminal result JSON, result revision, and creation time; this idempotency storage is shop-scoped and does not require a map slug for shop-page-origin checkout commands. Accepted checkout transactions also prepend a bounded GM-only `purchaseLog` entry to the shop document with timestamp, actor/profile summary, payment source, delivery target, purchased lines, and total; duplicate `opId` replays return the stored terminal result and do not add another audit row. Player read routes, player checkout responses, and player realtime delivery redact this audit metadata along with GM notes, while the GM shop editor shows the recent entries for troubleshooting. Accepted checkout transactions now append durable realtime updates for the changed shop document/list summary and any changed group inventory or trainer sheet documents, plus a terminal accepted command event that can acknowledge the originating checkout outbox if realtime arrives before HTTP. Rejected stored checkout results append a terminal rejected command event without document updates. Both kinds of sequenced events publish only after SQLite commit. `data/shops/` is an explicit export/interchange hierarchy only, and exported shop documents include `revision` and `updatedAt` so maintenance backups do not drop checkout-critical stock metadata.

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

The app uses this content for Pokédex browsing, reference pages, sheet defaults, lookup helpers, and automation support. GM Pokédex maintenance is the deliberate exception to app-checkout reference immutability: it writes a campaign-owned override diff at `data/reference-overrides/pokedex.json`, resolved under `ROTOM_CAMPAIGN_ROOT` when set, and layers replacement entries from that diff on top of `data/reference/pokedex.json` for the Pokédex API.

## Generated wild sheets

Encounter spawn flows persist generated Pokémon sheets into SQLite so they appear in the `/sheets` page like other Pokémon sheets. Standalone JSON generation/export remains maintenance/interchange tooling.

Use preview mode when you want to test an encounter roll without keeping generated files:

```bash
just encounter <region> <table> <slot-count> preview
```

The browser `/generate` page can also preview or write generated results depending on the workflow. Requested slot counts roll once per encounter slot, and `Nothing` rolls are skipped, so generated Pokémon/files can be fewer than the requested slot count.

## Local campaign data and `.gitignore`

The repository is configured for private campaign data ownership. If `ROTOM_CAMPAIGN_ROOT` is unset, campaign paths are under the app checkout. If it is set, the default SQLite database plus player profiles, campaign reference override diffs, and encounter tables are resolved under that campaign root instead. Base PTU reference data stays app-owned under `data/reference/`; Pokédex maintenance writes campaign overrides under `data/reference-overrides/pokedex.json`.

The default app repository hygiene is:

- SQLite databases/WAL sidecars, personal map/sheet JSON exports, player profiles, encounter tables, legacy live session snapshots, and optional event logs should not be committed by default
- curated example sheets and public sample encounter tables can remain trackable for review/demo purposes
- generated wild sheets should be reviewed before committing, if they are ever meant to be examples
- JSON should stay readable and inspectable rather than hidden behind opaque binary formats

Before publishing or sharing a branch, check `git status` and make sure private campaign notes, player profile data, player information, unreleased story material, session files, and one-off local data are not included. See [Player profiles and linked character control](player-profiles.md) for current profile behaviour and [live session storage](archive/live-session/live-session-storage.md) for legacy session snapshot/event-log backup and recovery guidance.
