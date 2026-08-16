# Group inventory item use

P8-065 extends the existing item-operation path to exact shared custody. It does not define a second item-mechanics engine.

## Table policy

- A GM may select any current Trainer as the acting Trainer.
- A player must select a Profile and may select only a Trainer explicitly linked to that Profile.
- The acting Trainer establishes the existing owned out-of-encounter target scope: that Trainer and its unambiguous current roster.
- The group inventory owns the exact source. The acting Trainer does not temporarily own or receive the row.
- Extended Actions remain transfer-first because their durable lifecycle requires Trainer custody. Encounter item use is unchanged.

The browser receives an opaque actor choice. It never authors a Trainer slug, source row, inventory instance, target template, definition, reservation, or mechanics payload.

## Authoritative flow

1. `GET /api/items/group-actions` loads the current group inventory, current authorised Trainers, linked Pokémon sheets, campaign clock, reviewed item definitions, and exact pending reservation totals.
2. The response exposes only safe actor labels, presentation rows, available quantities, target eligibility, bounded choices, previews, timing, costs, and unavailable reasons.
3. `POST /api/items/group-actions/declare` accepts one strict group revision, opaque actor choice, offer, and `use` intent.
4. The server reprojects the offer and privately binds the exact group row, inventory-instance identity, Trainer actor, target reads, campaign clock, and group revision.
5. The client adds only one fresh operation ID and exact server-issued target/choice selections.
6. `POST /api/items/use` reauthorizes the current shared actor policy and exact offer, then runs the existing `UseItemCommandV1` journal, execution context, eligibility, planner, reducer, recovery, and realtime path.
7. Accepted group and sheet resources replace client authority. The client never patches quantity or HP optimistically.

Any actor, delegation, Trainer revision, initial group revision, row, definition, quantity, reservation, target, choice, or campaign-clock drift fails before mutation. A pending shared reservation is deliberately row-scoped: settlement may rebase only to a newer group aggregate revision after the same source row, canonical definition, reserved quantity, actor, targets, and every non-group read revalidate.

## Reservations and races

Unresolved item operations reserve the exact quantity against the opaque group inventory instance. The same item-operation repository supplies reservation totals to:

- shared item-use projection and execution;
- group-to-Trainer Transfer projection and commit;
- Split, Merge, and Discard projection and commit.

A transfer or stack action cannot spend reserved quantity. Unrelated rows remain available while one row is reserved; changing an unrelated row does not strand the pending use. Immediate accepted use consumes and updates the group document in the same transaction as target mutations, the item receipt, and persisted realtime events. Cancellation or authenticated abandonment releases the reservation without JSON, SQLite, or manual repair. Reservations survive process restart.

## UI and recovery

The shared inventory page keeps the established 60/40 inventory/decision hierarchy:

- **Acting Trainer** is a 44px selector with a textual shared-custody boundary.
- **Use** sits beside Transfer on an exact row; Split, Merge, and Discard remain quieter management actions.
- The inline decision reuses the existing keyboard-operable target, bounded-choice, preview, acceptance, and Inspect anatomy.
- Mobile collapses to one column with the decision after inventory.
- A pending GM decision says that quantity is reserved and no mechanics apply yet.
- An uncertain request disables actor switching, refresh, cancellation, editing, and competing inventory mutations. **Retry exact use** is the only mutation path.

The UI never renders stable row IDs, inventory-instance IDs, operation/request/reservation IDs, Profile IDs, hashes, private ownership evidence, serialized equipment state, or provenance.

The attempted P8-065 image render could not complete because of the recorded sandbox/renderer blocker. The implementation follows `DESIGN.md`, the P8-065 brief, existing production components, and the accepted P8-064 60/40 mockup. Production-build desktop/mobile captures and the accepted implementation review are under `.pi/artifacts/ui-validation/group-inventory-item-use/`.

## Acceptance evidence

The versioned contract is `data/complete-play-loop/group-inventory-item-use.v1.json`. Focused evidence covers strict contracts, projection privacy, actor authorization, stale declarations, exact execution/replay, reservation-aware transfer and stack offers, process restart and abandonment, API boundaries, session exact retry, component interaction, and desktop/mobile accessibility.
