# Inventory split, merge, and discard

P8-064 extends the unified inventory action anatomy with authoritative **Split**, **Merge**, and **Discard** flows for Trainer and group inventory. These actions change stack shape or remove custody; they do not infer item mechanics from names or descriptions.

## Current offers

`GET /api/inventory/actions` projects stack actions beside each exact stable inventory source:

- Trainer stacks may be managed by the authenticated GM or a player controlling that Trainer.
- Shared group stacks may be split, merged, or discarded only by an authenticated GM. Player projections keep the controls unavailable with a textual authority reason.
- Every offer binds the current container revision, exact opaque source selection, current unreserved quantity, and one owning `inventory-stack-operation` handoff.
- Merge destinations are server-issued rows in the same container and section. At most 128 are projected.
- A section supports at most 256 rows after a split.

The safe projection contains container, section, presentation-row, item, quantity, consequence, and unavailable-reason labels. It never contains source, destination, or generated row IDs; serialized equipment identity or state; operation IDs; Profile IDs; hashes; reservation evidence; correction evidence; private notes; or provenance.

## Split

A split chooses a positive bounded quantity smaller than the current stack. Pending reservations remain on the original row, so the split must leave every reserved unit plus at least one ordinary source unit.

At declaration, the private adapter records the strict source row and allocates a deterministic operation-bound row ID. At commit:

1. the original row keeps its stable ID and exact metadata;
2. its quantity decreases by the selected amount;
3. one adjacent row receives the selected quantity, a new collision-checked stable ID, and byte-equivalent supported metadata.

Equipment-section and serialized whole-item rows never receive Split offers.

## Merge

Merge moves the whole exact source into one selected current destination. A destination is legal only when both rows:

- are ordinary quantity-bearing stacks in the same container and section;
- have the same exact normalized item identity;
- have equal cost, description, modifier, slot, and structured item-variant metadata; and
- sum within JavaScript’s safe-integer range.

Any pending reservation disables whole-stack merge. Commit removes the source row, retains the selected destination row ID, and increases only that destination quantity. Serialized equipment cannot merge.

## Discard

Discard removes a bounded unreserved quantity. A partial discard retains the source row ID; a whole discard removes the row. Equipment-section and serialized rows may discard exactly one whole item only, preserving their private before-state in the operation receipt.

Discard is irreversible through ordinary inventory actions. The server issues one opaque confirmation option, and `POST /api/inventory/actions/execute` rejects a missing or changed option. The shared decision card shows the safe source, selected and remaining quantities, an **Irreversible** warning, a native checkbox, revision recheck copy, Cancel, and a quantity-specific danger commit. No local quantity changes before acceptance.

## Atomic commit and recovery

Storage migration 41 rebuilds `inventory_action_operations` to admit `split`, `merge`, and `discard` while preserving every v40 row. The existing journal binds:

- declaration hash, authenticated principal, and exact Trainer or group scope;
- strict source and optional destination before rows;
- expected container revision and exact quantity;
- deterministic split identity when applicable; and
- accepted authoritative post-mutation sheet or group document.

The inventory revision, mutation, accepted adapter receipt, and persisted realtime events commit in one transaction. A receipt failure rolls back the inventory change. Stale rows, changed metadata, duplicate IDs, reservations, unresolved reusable Fishing Lures, unsafe sums, changed revisions, malformed stored commands, or changed replay input fail closed.

The browser retains one exact scope/profile-bound declaration only while a response is uncertain. Exact retry reuses that declaration. Accepted replay—including after process restart—returns immutable authoritative resources with `exactReplay: true` and cannot split, merge, or discard twice.

## Interaction target

The accepted target is [`.pi/artifacts/ui-mockups/inventory-stack-actions/v002.png`](../.pi/artifacts/ui-mockups/inventory-stack-actions/v002.png), scored 10/10. It preserves the existing 60/40 matte inventory workspace and one-column reflow. Ordinary and stack controls form two compact, wrapping groups. Danger red is proportional to the selected destructive path and is reinforced by warning text, iconography, checkbox state, and the exact submit label rather than colour alone. Controls remain at least 44px high with visible keyboard focus.
