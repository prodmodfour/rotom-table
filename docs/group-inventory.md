# Group inventory workflow

The group inventory feature gives the table one shared party inventory document that GMs and players can view during live play. It is intentionally separate from map state and trainer sheets so party supplies can be backed up, transferred, and synchronized without pretending that the party inventory is a token, map metadata, or a hidden trainer workbook.

## Runtime authority

- Runtime group inventory state lives in SQLite in the `group_inventories` table. The default document slug is `main`.
- The authoritative document contains `slug`, `revision`, `updatedAt`, `money`, normalized trainer-inventory-style `inventory` sections, stable row IDs for group rows, and optional display notes.
- The normal browser route is `/group-inventory`; both GM and player roles may load the shared `main` document.
- `data/group-inventories/*.json` is an explicit SQLite export/interchange shape only. Do not treat exported JSON as runtime fallback state, and do not store group inventory in map metadata or in a fake trainer sheet.

## Browser workflow

1. A GM or player opens **Inventory** in the main navigation.
2. The page loads the authoritative document through `GET /api/group-inventory/load`, creating the normalized `main` document if it does not already exist.
3. The page renders party money, section counts, item rows, optional notes, and transfer controls using the same inventory section model as trainer sheets.
4. Other clients receive durable realtime updates after saves and transfers so open group-inventory pages converge on the committed document.

Players can view the shared inventory, choose eligible transfer targets, and transfer only with linked trainer sheets. Players cannot perform direct full-document group inventory saves.

## GM direct edits

GM direct editing is a setup/maintenance-style document save, not a live-play command scope:

- Only GMs can edit party money and shared inventory item rows on `/group-inventory`.
- Saves call `POST /api/group-inventory/save` with `slug`, `expectedRevision`, a full `document`, and a client ID for realtime echo handling.
- The save route requires writable campaign mode and rejects non-GM actors.
- The repository normalizes the submitted document before persistence, increments the revision only when semantic content changes, and rejects stale `expectedRevision` values with a reload-before-saving conflict.
- Successful changed saves append a durable group inventory realtime update after the SQLite transaction commits.

This preserves the same revision-checked whole-document boundary used for other GM setup/edit saves while avoiding last-writer-wins overwrites.

## Trainer transfers

Transfers are authoritative server mutations. The UI waits for the API response before adopting any new group inventory or trainer sheet state.

- `POST /api/group-inventory/transfer-to-trainer` moves a quantity from the group inventory into a trainer sheet.
- `POST /api/group-inventory/transfer-to-group` moves a quantity from a trainer sheet back into the group inventory.
- Both directions validate the group inventory revision, the trainer sheet revision, section name, source row, and positive quantity.
- Stackable rows merge by normalized item identity. Equipment rows transfer as whole rows; partial equipment transfers are rejected.
- Each transfer uses one SQLite transaction for both documents and durable realtime rows. If either document is stale, missing, invalid, or fails to write, neither document is changed.
- GMs may transfer with any trainer sheet. Player requests must include the selected player profile ID, and that profile must link the source or target trainer sheet. Profileless and unlinked player transfers are rejected.

Affected trainer sheets are returned with the authoritative group inventory response and are also published as sheet realtime updates so trainer-sheet clients can converge.

## Realtime and recovery

Group inventory saves, transfers, and accepted move-automation writes append durable realtime events after the committing transaction succeeds:

- group inventory updates publish on `group-inventory:<slug>` with the complete authoritative document and a `group-inventory-access` delivery descriptor;
- transfer operations also publish affected trainer sheet updates through the existing sheet realtime destinations;
- `resolveMove` appends its group inventory update in the same SQLite transaction as map/sheet writes and the terminal operation result, then publishes the sequenced event only after commit;
- client IDs let the originating tab ignore or reconcile its own echo consistently with the rest of the realtime client code;
- stale or malformed incoming group inventory events are ignored rather than applied over newer local state.

The durable realtime log is replay history, not permanent state. If a client misses retained events or reconnects after a restore, it should reload the aggregate authoritative state instead of reconstructing inventory from event history.

## Backup, export, and production caveats

Group inventory is part of the live campaign database. Private operators should back up the SQLite database and WAL sidecars as one unit along with remaining campaign JSON such as player profiles and encounter tables. `npm run export:sqlite-json -- --output /safe/export/path` exports group inventories under `data/group-inventories/` with `revision` and `updatedAt` fields for maintenance/interchange review.

Rotom Table still uses a trusted-table GM/Player role picker. It is not public authentication. Private VPS use needs an outer access gate, and production hosted writes remain fail-closed unless the operator explicitly enables the documented hosted-write flag. Do not fix or deploy production group inventory behavior by editing production runtime files directly; change app code in the repository and deploy through the normal project path.

## Move-automation live-play command boundary

`resolveMove` may now carry an explicit `{ kind: "groupInventory", slug, field: "inventory" }` scope when reviewed server move metadata requires that shared item resource. Other map command types cannot use this scope, and move scopes cannot address group money. Submitting the scope does not grant mechanics or inventory authority: the server must independently load the named group inventory through a reviewed item requirement, retain its revision in the private read set, and produce a typed `group-inventory-state` change. A scope for an unreviewed slug rejects.

Before an immediate move commits, the server validates the map revision, the full consulted sheet read set, and every consulted group inventory revision under one SQLite write lock. Each typed group inventory change must match the corresponding read revision and advances that document exactly once through repository CAS. The map, damage or other sheet effects, group inventory item changes, terminal operation result, compensation audit metadata, and authorized durable realtime rows then commit together or all roll back. An exact duplicate move `opId` returns the stored result without applying the item change or publishing it again.

This boundary remains narrower than direct inventory editing:

- clients submit move intent and conservative resource scopes, never item patches, quantities, destination mechanics, or replacement documents;
- only typed server-reviewed item plans may produce group inventory writes;
- direct GM full-document saves remain the setup/maintenance path;
- page-level trainer transfers retain their existing role/profile policy and APIs;
- item choices and shared move-family mutation semantics remain separate durable automation capabilities.
