# Live play authority

This document defines Rotom Table's normal multiplayer system: server-authoritative profile play on regular `/maps/<slug>` routes. This is normal profile play. The legacy `/sessions` surface is maintenance-only while it remains in the codebase.

## Non-negotiable authority boundary

SQLite is the only runtime authority for maps, Pokémon sheets, trainer sheets, group inventories, shop tables, map folders, sheet folders, shared map interaction mode, map live-play operation results, shop checkout operation results, and durable realtime replay events.

Normal API requests must not read runtime maps, sheets, group inventories, or shop tables from `data/maps`, `data/sheets`, `data/trainers`, `data/group-inventories`, or `data/shops`, and normal mutations must not write authoritative map/sheet/group-inventory/shop JSON. JSON map/sheet/group-inventory/shop files are limited to explicit migration/import where supported, explicit export/interchange, operator backup material, or clearly labeled generation output. Encounter spawn generates Pokémon sheets in memory, then persists the generated sheets and map placements to SQLite in one transaction.

Browser-owned whole-map autosave is never the authority for live gameplay. During live play, clients send explicit commands. The server accepts or rejects those commands after validating actor, profile, visibility, token/sheet control, command shape, `baseRevision`, and conflict scope.

## Mode split

### Prepare Map / setup-edit

Setup/edit mode is GM/operator preparation and maintenance. Whole-document map and sheet saves write SQLite documents and require an `expectedRevision`; stale saves reject. The map save route requires GM role, explicit `interactionMode: "setup-edit"`, and the shared map mode to be **Prepare Map**.

### Run Live Play

Live play uses persistent player profiles and normal map URLs. Gameplay mutations are commands such as move token, turn token, modify HP/conditions/combat stages, resolve a move, use a move/ability/order/manoeuvre, send out, capture, advance initiative, place hazards, edit terrain, spawn/delete tokens, and update sheet-backed combat state. Command routes reject while the map is in **Prepare Map**.

### Shared group inventory

The `/group-inventory` page is campaign-level inventory state, not map metadata and not a hidden trainer sheet. GM direct edits use revision-checked full-document saves. GM and player trainer transfers use atomic page-level APIs that validate both group inventory and trainer sheet revisions; player transfers are limited to trainer sheets linked to the selected player profile. A future `groupInventory` live-play command scope should be added only if in-map item consumption or another gameplay command needs to mutate party inventory. See [Group inventory workflow](group-inventory.md) for the current workflow and future command boundary.

## Atomic command and batch workflows

Every accepted persistent command or batch workflow uses one synchronous SQLite transaction for all affected documents, live-operation results, and durable realtime rows. Expected map/sheet revisions are checked before writing. Complete changed documents are written once. Durable event rows are appended before commit. Exact sequenced events are published only after commit, so rollback cannot produce a success publication.

This applies to:

- live move resolution, capture, send out, ability/order/manoeuvre, move usage, HP/condition/combat-stage changes, initiative, terrain, hazards, field effects, scene, start-turn modal, token spawn/delete/move/turn, and attack of opportunity commands;
- sheet rename/delete with map placement retargeting or cleanup;
- encounter spawn;
- campaign next-day processing;
- setup map and sheet saves;
- map/sheet library and folder mutations;
- shared map interaction-mode changes;
- group inventory GM saves and trainer transfers;
- accepted shop checkout commands that update shop stock plus trainer sheet or group inventory money/inventory.

Map live-play idempotency records are keyed by map and `opId`; shop checkout idempotency records are keyed by shop and `opId`. A retry with the same command body returns the stored result without applying effects twice. Reusing an `opId` with different material is rejected.

### Live-play batch commands are not client-side macros

Sprint 4 batch commands (`clearHazards`, `clearFieldEffects`, `editTerrainVoxels`, and `editHazards`) are explicit live-play command types, not browser-side loops over primitive commands. When the UI presents one cleanup or brush intention, the client sends one bounded command body and one `opId` whenever the stroke fits within the shared batch limit. The server validates the whole payload, role/profile authority, map visibility, bounds, base revision, conflict scopes, and operation identity before mutating anything.

Accepted batch commands commit all effects, the terminal operation result, and durable realtime rows in one SQLite transaction. A rejected stale, conflicting, hidden, unauthorized, invalid, oversized, or contradictory batch applies none of its requested changes. Retry/status recovery must reuse the exact same command body and `opId`; duplicate HTTP/SSE/status terminals may acknowledge recovery state but must not apply accepted patches twice.

Shared payload bounds keep batch authority narrow: explicit hazard-cell batches are capped at 128 operations, explicit terrain voxel/cell batches at 256 operations, explicit field-effect kind operations at 16, and affected-token summary lists at 64 IDs. Strict parsing rejects unknown durable-state fields, private/profile data, arbitrary records, and over-large strings before executor code runs. Duplicate or contradictory terrain/hazard cell operations reject, except idempotent clear-by-cell payloads may normalize repeated cells.

If a live-play brush stroke exceeds its command limit, the client may split it into ordered bounded batch commands. Each chunk is still a separate authoritative transaction with its own command body and recovery state; later chunks stop after a rejected or uncertain chunk. The client must not keep terrain or hazard edits as authoritative local state without accepted patches or reconciliation.

Batch pending and recovery UI may summarize command kind and counts, for example “Clearing 12 hazards…” or “Applying terrain brush (8 cells)”, but it must not display full payload coordinates, raw command bodies, profile IDs, sheet data, access-gate data, hostnames, or secrets. Presence, pings, targeting intent, and GM attention remain presentation-only and never transport batch commands.

## Durable realtime events and authorised SSE replay

Persistent map, sheet, shop, group inventory, library, folder, and mode mutations append durable realtime events in the same SQLite transaction as their authoritative writes. Each row carries an explicit server-internal access descriptor: `gm-only`, `map-access`, `sheet-access`, `group-inventory-access`, or `shop-access`. Delivery evaluates that descriptor against current SQLite state and the connection principal; it does not trust channel names or payload fields.

The normal live-play stream is `GET /api/events` using Server-Sent Events. The stream keeps quiet tables open with heartbeat comments and records SSE connect/disconnect events for operator diagnostics. A reconnect is a possible missed-event gap, so clients reconcile from `/api/maps/load?slug=<slug>` when replay cannot bridge the cursor. Replay rows have one globally monotonic sequence. Initial connections without a cursor start at the current tail and do not replay stale history. Reconnects send a per-context `after` cursor and receive only authorised retained rows. Denied rows are never serialized to the client; they still advance checkpoints so clients do not loop on inaccessible events.

Access boundaries:

- hidden maps never reach players;
- a profile receives only its own profile-linked sheets plus public/player-visible map sheets;
- unprofiled player context has its own cursor and sheet-access rules;
- GM-only folders, tombstones, and administrative library events never reach players;
- shop updates reach players only while the referenced shop is currently open and player-visible;
- profile changes close the old stream before opening the new profiled stream.

The server combines in-process wakeups with SQLite polling, so one process can commit a durable event and another process can deliver it after polling or restart. Wakeups and polling share the same sequence cursor and do not duplicate delivery.

Shopfront and GM shop editor pages subscribe to `shop:<slug>` for the loaded shop document. Shop checkout commits also append terminal `live-play-command-accepted`/`live-play-command-rejected` rows on `shop:<slug>` so the originating checkout outbox can be acknowledged even when SSE wins the race with the HTTP response. Accepted terminal shop events carry the authoritative shop document only; trainer sheet and group inventory convergence still uses their resource-specific channels or an explicit reload, so shop-access replay does not expose participant documents to every shop viewer. Shopfront checkout state also subscribes to `group-inventory:<slug>` and `sheet:trainer:<slug>` only for payment/delivery documents already loaded on the page. Client handlers ignore ordinary local echo document events by `clientId`, reject stale revisions, and apply only complete authoritative documents. When another client changes finite stock below a cart quantity, the cart clamps to the new limit and shows a non-blocking stock-change notice instead of sending an optimistic or stale checkout.

## Ephemeral presence and table-feel state

Live-play presence is presentation-only table-feel state, not gameplay authority. Connected participant summaries, remote token hover/selection, map pings, targeting or measurement intent, and GM attention requests are short-lived signals that help players coordinate around the map. They never grant token control, never satisfy command authorization, never mutate map/sheet/shop/group-inventory documents, never advance map revisions, and never replace explicit live-play command routes.

Presence uses the map presence snapshot/heartbeat API plus transient `/api/events` delivery when available. Presence entries are sanitized to display-safe participant labels, roles, tab suffixes, accents, visible token IDs, small intent summaries, short ping labels, and optional GM attention targets. The presence contract rejects command bodies, sheet payloads, raw profile IDs, access-gate data, hostnames, secrets, arbitrary records, over-large strings, durable-state fields, and hidden/private details.

Server-side presence is process-local in memory and expires by TTL. It is not written to SQLite, campaign JSON, the durable realtime event log, cursor storage, outbox journals, or operation-history tables. Transient presence updates are unsequenced and non-durable; reconnecting clients rebuild table-feel state from the current snapshot and fresh heartbeats, not from replay history. A service restart or process handoff may clear presence without affecting authoritative gameplay state.

Presence access follows the same role, selected-profile, and map visibility boundaries as live-play viewing. Hidden maps do not expose presence, pings, remote attention, or intent to players. Profile changes close the old realtime context and clear old-context presence before the new profile publishes fresh display-safe state. Client-published token IDs, ping cells, intent cells, and GM attention targets are dropped or rejected unless they are visible in the caller's current map context; player-authored GM attention requests are rejected or downgraded to ordinary table pings.

Presence failure must degrade gracefully. Snapshot failure, heartbeat failure, lost transient updates, stale entries, hidden-tab throttling, or missing presence freshness metrics may show a small non-blocking status, but command dispatch remains governed only by the existing command, outbox, replay, reconciliation, revision, and authorization blockers. Local predictions, pending indicators, correction notices, and authoritative patches keep priority over remote hover/selection/intent overlays.

## Retention and gap reconciliation

The durable realtime log is replay history, not permanent campaign state. Retention can prune old rows by age and row count while preserving cursor-state invariants. A pruned cursor produces a controlled `gap` response; a cursor beyond the latest sequence produces an `ahead` response. The client treats either as a single aggregate snapshot requirement, reloads authoritative SQLite map/sheet/mode state, advances the context cursor to the server tail, and never rewinds a stored cursor.

Retention is configured by environment variables and can be inspected or run manually with the operator scripts:

```sh
npm run realtime:status
npm run realtime:prune
```

The scheduler uses the same repository pruning path as the CLI and must not mutate client cursor storage; clients reconcile from server cursor state on their next stream.

## Client cursor and recovery model

Realtime cursors are stored per delivery context: GM, unprofiled player, and each selected player profile. Reconnect/replay pauses live-play command dispatch until the client is caught up or reconciled. The map page state machine exposes loading, ready, saving-command, reconnecting, reconciling, stale, and error states.

Local predictions are presentation-only overlays on top of the last authoritative map. The narrow predicted surface is token movement/facing plus token-level pending feedback for supported simple HP or condition edits; it does not mutate cached sheet documents or become durable state. When a remote authoritative patch arrives while local predictions are pending, clients adopt the authoritative patch against clean map state and then layer back only safe non-conflicting predictions. Conflicting predictions roll back through correction or reconciliation. HTTP, SSE, replay, and status-check terminal results for the same `opId` are idempotent: stale duplicates can acknowledge recovery state but must not apply patches twice or roll back already accepted state.

The originating map view highlights tokens that are waiting for server confirmation, keeps unrelated tokens interactive, and shows a small correction notice if the server rejects a predicted token action and the overlay rolls back.

The recovery panel means:

- **Pending/queued**: command is journaled locally before send and has not reached a terminal state.
- **Sending**: a lease-owning tab is sending the exact journaled body.
- **Uncertain**: the HTTP response was lost; retry/status must reuse the exact same `opId` and body.
- **Accepted/acknowledged**: accepted SSE or terminal status removed the outbox row.
- **Abandoned**: abandonment serialized against execution and no future retry should send the command.

Recovery never replays local presentation-only effects. Duplicate accepted/status results are idempotent and do not apply state twice.

## Outbox, status, retry, and abandonment

Map live-play commands and shop checkout commands can be journaled in IndexedDB before send. The journal stores request path, exact body, auth context, fingerprint, state, attempts, and lease data; shop checkout rows are scoped by `shopSlug` and do not require a top-level `mapSlug` for shop-page-origin purchases. Retry resends the exact body and `opId`. Map command status checks are read-only. Map abandonment serializes against execution; if the server has already accepted the command, the accepted result wins and acknowledges the outbox. Accepted SSE acknowledges matching map outbox entries; shop checkout terminal SSE acknowledges matching checkout outbox entries and stale local shop state requests reload/reconciliation instead of applying an out-of-date result over newer local state.

## JSON import/export boundary

Use JSON only for explicit maintenance:

- Operators can migrate an existing private campaign with `npm run migrate:sqlite`; the command imports maps/sheets/folders into SQLite, creates a pre-migration backup, validates rows, and validates that imported maps/sheets can be loaded from the database.
- `npm run export:sqlite-json -- --output /safe/export/path` exports SQLite maps/sheets/trainers, group inventories, and shop tables for backup or interchange. Use `--force` only to replace a known export destination.
- Standalone encounter generation may emit JSON as explicit generation output; encounter spawn does not use generated JSON as runtime authority.

Do not treat residual JSON under campaign roots as fallback state. Do not commit private campaign JSON or generated runtime artifacts.

## Operator runbook

Required/private-host environment variables:

- `ROTOM_CAMPAIGN_ROOT`: private campaign directory. Keep it outside the app repository for production-like hosts.
- `ROTOM_DB_PATH`: optional SQLite database path. Defaults to `rotom-table.sqlite` under `ROTOM_CAMPAIGN_ROOT`.
- `ROTOM_ENABLE_HOSTED_WRITES=1`: exact production opt-in for hosted writes. Production without this flag fails closed for covered writes.
- Realtime retention variables from `server/realtime/realtimeEventRetentionConfig.ts`: enablement, retention days, max rows, and prune interval.

Backup expectations:

1. Stop the service when possible, or pause table activity and use SQLite's backup API.
2. Back up the database plus WAL sidecars: `rotom-table.sqlite`, `rotom-table.sqlite-wal`, and `rotom-table.sqlite-shm` when present.
3. Include residual maintenance JSON such as player profiles, encounter tables, reference overrides, assets, and any intentional import/export copies.
4. Store archives outside the tracked app repository and verify a restore before relying on them.

Retention operations:

```sh
npm run realtime:status        # inspect current cursor/log/retention plan
npm run realtime:prune         # apply configured prune policy once
```

Diagnosing replay gaps:

- A `gap` means the client's cursor is older than retained history. Reload the aggregate snapshot and continue from the reported latest sequence.
- An `ahead` means the client cursor is newer than the server tail, usually after restore or rollback. Reload the aggregate snapshot and reset only through the normal client reconciliation path.
- Repeated gaps usually mean retention is shorter than the supported reconnect/recovery window.

Safe rollback/restore:

- Restore SQLite database and WAL sidecars as one unit.
- Expect clients with cursors from the abandoned future to receive `ahead` and reconcile from a snapshot.
- Do not copy JSON maps/sheets/group inventories over SQLite as a rollback mechanism; import/export is an explicit maintenance operation.

## Legacy `/sessions` boundary

Documents and code with `session` or `/sessions` names describe the legacy guarded session-local surface unless they explicitly say otherwise. The legacy documentation is archived under [Archived legacy live-session documents](archive/live-session/README.md). Normal profile play has no join code, map attachment step, session-owned map copy, share link, invite link, or per-map invite.
