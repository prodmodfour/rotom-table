# BUILD_TICKETS.md

AUTOMATION_STATUS: NOT_DONE

Ticket statuses:

* TODO — not done
* DONE — done

The build loop must select the lowest-numbered TODO ticket. Each ticket below maps to one Rotom Table GitHub issue (#27-#44).

Autonomous cycle rules for every ticket: implement only the selected ticket, run `scripts/quality-gate.sh`, update only the selected ticket status, commit with a conventional commit message, and leave the working tree clean. The final ticket (#44) may also set `AUTOMATION_STATUS: DONE` after all issue tickets are complete.

---

## 027 — #27: Group inventory: add shared document types and normalizers

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/27

### Goal
Introduce the shared TypeScript model for campaign group inventory without adding persistence or UI yet.

### Scope
- Add `src/types/groupInventory.ts` or an equivalent shared type location.
- Define a `GroupInventoryDocument` with `slug`, `revision`, `updatedAt`, `money`, `inventory`, and optional notes.
- Reuse the existing trainer inventory section keys and `InventoryEntry` shape where practical.
- Add stable row IDs for group inventory entries.
- Add normalizer helpers that:
  - create a default `main` group inventory document;
  - guarantee all inventory sections exist as arrays;
  - coerce quantities to safe non-negative integers;
  - trim item names and notes;
  - strip UI-only/unknown unsafe fields where appropriate.

### Acceptance criteria
- Types compile under `npm run typecheck`.
- Normalizer tests cover empty input, legacy/partial section objects, bad quantities, and row ID generation.
- No server routes, SQLite tables, or UI pages are added in this ticket.

### Depends on
None.

---

## 028 — #28: Group inventory: add SQLite migration for campaign inventories

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/28

### Goal
Create the durable SQLite storage table for group inventory documents.

### Scope
- Add a new storage migration that increments `LATEST_STORAGE_SCHEMA_VERSION`.
- Create `group_inventories` with:
  - `slug TEXT PRIMARY KEY`
  - `document_json TEXT NOT NULL`
  - `revision INTEGER NOT NULL`
  - `updated_at INTEGER NOT NULL`
- Keep this ticket limited to schema creation and migration tests.

### Acceptance criteria
- Migration versions remain contiguous.
- Migration tests prove the new table is created on a fresh database and when upgrading from the prior schema version.
- No repository, API, or UI code is added in this ticket.

### Depends on
- #27

---

## 029 — #29: Group inventory: add SQLite repository with revision-checked updates

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/29

### Goal
Add the server-side repository for loading, creating, saving, and live-play-style updating group inventory documents.

### Scope
- Add `server/storage/groupInventoryRepository.ts`.
- Implement `get`, `getOrCreate`, `save`, `replaceSetupInventory`, and `applyLivePlayUpdate`.
- Follow the map/sheet repository conventions for:
  - JSON cloning/stringifying;
  - authority fields (`slug`, `revision`, `updatedAt`);
  - revision-checked updates;
  - returning `stale` instead of overwriting changed documents.
- Default to a `main` inventory document when none exists.

### Acceptance criteria
- Repository tests cover create, read, no-op semantic save, revision increment, stale update rejection, and normalization before persistence.
- Repository code does not introduce HTTP routes or UI.
- `npm run typecheck` and targeted repository tests pass.

### Depends on
- #27
- #28

---

## 030 — #30: Group inventory: add load API route and client route constants

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/30

### Goal
Expose the authoritative group inventory document to the browser.

### Scope
- Add `GROUP_INVENTORY_API_PATHS` to `src/utils/apiRoutes.ts`.
- Add `server/api/group-inventory/load.get.ts` or equivalent.
- Return the `main` group inventory by default, creating it if missing.
- Allow both GM and player roles to load the shared inventory.
- Keep mutation out of this ticket.

### Acceptance criteria
- API tests cover GM load, player load, missing-document creation, and invalid slug rejection if slugs are supported as query params.
- Response contains `slug`, `revision`, `updatedAt`, `money`, and normalized `inventory` sections.
- No save, transfer, or UI code is added in this ticket.

### Depends on
- #29

---

## 031 — #31: Group inventory: add GM-only revision-checked save API route

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/31

### Goal
Allow GM users to save direct edits to the group inventory document with revision protection.

### Scope
- Add `server/api/group-inventory/save.post.ts` or equivalent.
- Require GM role and writable campaign mode.
- Accept `slug`, `expectedRevision`, and a full group inventory document.
- Delegate to a use case that calls the group inventory repository.
- Return the authoritative saved document and whether it changed.

### Acceptance criteria
- GM save succeeds and increments revision when semantic content changes.
- GM save returns unchanged/no-op behavior when the submitted semantic document matches storage.
- Stale `expectedRevision` is rejected with a clear conflict error.
- Player and guest access are rejected.
- Tests cover validation, stale rejection, and normalization before save.

### Depends on
- #30

---

## 032 — #32: Inventory UI: extract reusable item table from trainer inventory table

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/32

### Goal
Make the existing trainer inventory item table reusable for group inventory without changing trainer-sheet behavior.

### Scope
- Extract the generic table portion of `TrainerInventoryItemTable.vue` into a reusable inventory component.
- Keep support for the current variants: `standard`, `pokeBalls`, and `equipment`.
- Preserve item autocomplete, autofill behavior, quantity/cost/mod/slot/description editing, add row, and remove row.
- Leave `TrainerInventoryItemTable.vue` as a compatibility wrapper if that keeps the diff smaller.

### Acceptance criteria
- Existing trainer inventory UI behaves the same before and after the refactor.
- Existing trainer inventory tests still pass; add focused component tests if coverage is missing.
- No group inventory page or API calls are added in this ticket.

### Depends on
None.

---

## 033 — #33: Inventory UI: extract reusable section tabs from trainer inventory panel

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/33

### Goal
Extract the inventory section tab UI so group inventory and trainer inventory can share the same section navigation.

### Scope
- Extract the subtabs/counts portion of `TrainerInventoryPanel.vue` into a reusable component.
- Continue to use `TRAINER_INVENTORY_SECTIONS` as the source of section metadata.
- Preserve active-tab behavior and section counts for trainer sheets.
- Keep this as a behavior-preserving refactor.

### Acceptance criteria
- Trainer inventory tabs, counts, and active-section switching behave the same as before.
- Tests cover section switching and count rendering if not already covered.
- No group inventory route, persistence, or transfer behavior is added in this ticket.

### Depends on
- #32

---

## 034 — #34: Group inventory: add page shell and navigation entry

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/34

### Goal
Add a visible place for the shared party inventory without wiring persistence yet.

### Scope
- Add route constants for `/group-inventory` or the chosen path.
- Add a primary navigation entry labeled `Inventory` visible to GM and players.
- Add `src/pages/group-inventory.vue` with `AppNavigation`, page title, empty/loading/error states, and a placeholder panel.
- Keep the page static in this ticket; do not call the API yet.

### Acceptance criteria
- GM and player nav both show the Inventory link.
- The page renders successfully and has a sensible title/head metadata.
- Guest behavior follows existing route/auth conventions.
- No persistence, save, or transfer behavior is added in this ticket.

### Depends on
None.

---

## 035 — #35: Group inventory: add read-only panel using shared inventory components

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/35

### Goal
Render the authoritative group inventory document in the new page using the reusable inventory components.

### Scope
- Add `GroupInventoryPanel.vue` or equivalent.
- Call the load API from the group inventory page.
- Render money, section tabs, section counts, and inventory rows.
- Keep player and GM behavior read-only in this ticket.
- Reuse the generic inventory table and section tab components.

### Acceptance criteria
- Loading, error, and empty inventory states are visible and accessible.
- The page renders all inventory sections with normalized data from the server.
- Players and GMs can both view the shared inventory.
- No direct editing, saving, or transfers are added in this ticket.

### Depends on
- #30
- #33
- #34

---

## 036 — #36: Group inventory: enable GM direct editing and save on the inventory page

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/36

### Goal
Let GM users edit the shared inventory directly through the group inventory page.

### Scope
- Enable row add/remove/edit controls only for GM users.
- Add money editing for GM users.
- POST full-document saves to the revision-checked save API.
- Show saving, saved, conflict, and generic error states.
- On stale save conflict, reload or offer a clear refresh path instead of overwriting.

### Acceptance criteria
- GM can add, edit, and remove item rows and money, then save.
- Player users still see read-only inventory controls.
- Save uses `expectedRevision` and updates the local document to the authoritative response.
- Stale revision behavior is tested at the composable/page level where practical.

### Depends on
- #31
- #35

---

## 037 — #37: Group inventory: add shared item merge and quantity transfer helpers

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/37

### Goal
Add pure helpers for moving item quantities between inventory documents before wiring server routes.

### Scope
- Add utility functions for:
  - finding a group inventory row by section and row ID;
  - decrementing or removing a source row;
  - merging stackable rows by normalized item identity;
  - treating equipment rows as whole-row transfers;
  - moving money between documents if money transfer is included.
- Keep helpers pure and independent from SQLite/API code.
- Reuse trainer inventory section keys and entry types where possible.

### Acceptance criteria
- Unit tests cover stackable item transfer, exact-quantity removal, partial decrement, equipment whole-row transfer, invalid quantities, missing rows, and name normalization.
- Helpers do not mutate their inputs unless explicitly documented and tested.
- No HTTP routes or UI are added in this ticket.

### Depends on
- #27

---

## 038 — #38: Group inventory: add atomic group-to-trainer transfer route

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/38

### Goal
Move item quantities from the shared group inventory into a trainer sheet atomically.

### Scope
- Add a use case and API route for group-to-trainer transfers.
- Accept `groupSlug`, `groupRevision`, `trainerSlug`, `trainerRevision`, `section`, `itemId`, and `quantity`.
- In one SQLite transaction:
  - read the group inventory and trainer sheet;
  - validate both revisions;
  - decrement/remove the group row;
  - merge the item into the trainer inventory section;
  - increment both document revisions;
  - return the authoritative group inventory and trainer sheet update.
- Start with GM-only access in this ticket.

### Acceptance criteria
- Successful transfer updates both documents atomically.
- If either revision is stale, neither document changes.
- Invalid quantity, missing row, missing trainer, and equipment partial-transfer cases are rejected clearly.
- Tests prove rollback when the second write fails.

### Depends on
- #29
- #37

---

## 039 — #39: Group inventory: add atomic trainer-to-group transfer route

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/39

### Goal
Move item quantities from a trainer sheet back into the shared group inventory atomically.

### Scope
- Add a use case and API route for trainer-to-group transfers.
- Accept `trainerSlug`, `trainerRevision`, `groupSlug`, `groupRevision`, `section`, a trainer row identifier or row index, and `quantity`.
- In one SQLite transaction:
  - read the trainer sheet and group inventory;
  - validate both revisions;
  - decrement/remove the trainer row;
  - merge the item into the group inventory section;
  - increment both document revisions;
  - return the authoritative trainer sheet update and group inventory.
- Start with GM-only access in this ticket.

### Acceptance criteria
- Successful transfer updates both documents atomically.
- If either revision is stale, neither document changes.
- Invalid quantity, missing row, missing group inventory, and equipment partial-transfer cases are rejected clearly.
- Tests cover stackable and equipment transfers.

### Depends on
- #29
- #37
- #38

---

## 040 — #40: Group inventory: allow player transfers for linked trainer sheets

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/40

### Goal
Extend transfer routes so player users can move items only for trainer sheets linked to their selected player profile.

### Scope
- Update group-to-trainer and trainer-to-group transfer routes/use cases to accept player actors.
- For GM users, preserve unrestricted transfer authority.
- For player users:
  - require a selected player profile;
  - verify the target/source trainer sheet is linked to that profile;
  - reject transfers involving unlinked trainer sheets.
- Do not allow players to perform direct full-document group inventory saves.

### Acceptance criteria
- Player with linked trainer can transfer group-to-trainer and trainer-to-group.
- Player without a selected profile is rejected with a clear message.
- Player with an unrelated profile/trainer link is rejected.
- GM behavior remains unchanged.
- Tests cover both transfer directions and both success/failure authorization paths.

### Depends on
- #38
- #39

---

## 041 — #41: Group inventory: add transfer UI between party inventory and trainers

Status: DONE

Issue: https://github.com/prodmodfour/rotom-table/issues/41

### Goal
Let users move items between the shared group inventory and trainer inventories from the group inventory page.

### Scope
- Add a transfer modal or inline transfer action to group inventory rows.
- Let the user choose an eligible trainer sheet.
- Let the user choose quantity for stackable items.
- Treat equipment as whole-row transfers.
- Call the group-to-trainer and trainer-to-group transfer APIs.
- Update the local group inventory and affected trainer sheet state from authoritative responses.
- For players, show only profile-linked trainer choices.

### Acceptance criteria
- GM can transfer items to/from any trainer sheet.
- Player can transfer items only to/from linked trainer sheets.
- Transfer controls handle loading, success, validation errors, and stale revision errors.
- UI does not silently mutate local state before the authoritative response.
- Component/page tests cover at least one successful transfer and one rejected transfer.

### Depends on
- #35
- #38
- #39
- #40

---

## 042 — #42: Group inventory: publish realtime updates for saves and transfers

Status: TODO

Issue: https://github.com/prodmodfour/rotom-table/issues/42

### Goal
Keep other open clients in sync when the group inventory changes.

### Scope
- Define a realtime channel/event type for group inventory updates, or extend the existing library mutation realtime pattern if that fits cleanly.
- Publish an authoritative group inventory update after GM save.
- Publish authoritative group inventory and affected trainer sheet updates after transfers.
- Include client IDs so the originating tab can ignore or reconcile its own echo consistently with existing realtime patterns.
- Keep this focused on realtime update publication/consumption, not live-play command scopes.

### Acceptance criteria
- Two clients viewing the group inventory converge after a GM save.
- Two clients viewing the group inventory converge after a transfer.
- Originating client does not duplicate optimistic mutations.
- Tests cover event access/shape and client-side application where existing realtime test harnesses make that practical.

### Depends on
- #36
- #41

---

## 043 — #43: Group inventory: include campaign inventories in maintenance export/backup scripts

Status: TODO

Issue: https://github.com/prodmodfour/rotom-table/issues/43

### Goal
Make sure group inventory data is not missed by maintenance export/backup flows.

### Scope
- Update SQLite JSON export/backup scripts to include `group_inventories`.
- Add tests proving exported data includes group inventory documents with revision and updatedAt fields.
- If import/migration helpers have central table assumptions, update them to tolerate or restore group inventory data.
- Keep this limited to maintenance scripts and tests.

### Acceptance criteria
- Existing export tests still pass.
- New export test includes at least one group inventory document.
- Running the export script does not silently drop group inventory state.
- No UI or API behavior changes are added in this ticket.

### Depends on
- #28
- #29

---

## 044 — #44: Group inventory: document workflow and future live-play command boundary

Status: TODO

Issue: https://github.com/prodmodfour/rotom-table/issues/44

### Goal
Document how group inventory works now and where live-play command integration should happen later.

### Scope
- Add or update docs explaining:
  - group inventory is campaign-level SQLite state, not map metadata or a fake trainer sheet;
  - GM direct edits are revision-checked saves;
  - player transfers are limited to linked trainer sheets;
  - realtime updates keep other open clients in sync;
  - live-play command scopes are intentionally deferred unless a later feature needs in-map item consumption.
- Mention any production/auth caveats consistent with the existing trusted-table model.

### Acceptance criteria
- Documentation is linked from an appropriate architecture or feature doc.
- The doc gives future implementers a clear boundary for possible `groupInventory` live-play scopes without requiring that work now.
- No code behavior changes are added in this ticket.

### Depends on
- #42
- #43

### Completion marker

- After this issue scope is complete, verify tickets 027-043 are `DONE`, run `scripts/quality-gate.sh`, mark ticket 044 `DONE`, and set the top-level line to `AUTOMATION_STATUS: DONE` in the same commit.

---
