# Inventory source selection and safe provenance

P8-062 makes the exact supplying container and presentation row visible before an inventory action. It does not expose or trust the underlying row, serialized-item, operation, Profile, or ownership-evidence identity.

## Sheet item sources

Each sheet item offer now projects:

- one opaque offer-local `sourceSelectionId`;
- `Trainer inventory` as the safe container label;
- the inventory section label;
- a section-local presentation label such as `Row 1`;
- the current quantity; and
- the Trainer and source revision already bound by the offer.

The parser requires `rowLabel === Row (rowIndex + 1)` and rejects duplicate source-selection identities. Internal `InventoryEntry.id` and `item-instance:*` authority remain server-only.

When more than one current enabled offer has the same exact canonical item identity, `projectSheetItemInventorySources()` creates a bounded source radiogroup. Unavailable, unsupported, stale, or differently identified rows are not silently treated as alternatives. Changing source selects a different current server offer and clears target-specific choices. Submission then redeclares that exact offer; the server reloads the Trainer revision and maps the offer back to the private source row before creating an item command.

## Transfer sources

Group-to-Trainer transfer already submits a stable group row ID. Trainer-to-group UI now submits the selected stable `trainerItemId` rather than a presentation index. The server retains legacy index parsing for old clients, but current UI requires a saved row identity and shows:

- `Group inventory · <section> · Row N`, or
- `Trainer inventory · <section> · Row N`.

Both inventory revisions and the exact source row are rechecked in the transfer transaction. Duplicate display names never decide custody.

## Local preference boundary

The browser may remember only:

```json
{
  "schemaVersion": 1,
  "preferredContainerKind": "trainer",
  "preferredSection": "medicalKit"
}
```

This preference can order safe presentation options only. It contains no sheet slug, row or offer identity, Profile ID, operation ID, serialized state, or provenance. Malformed or expanded values are deleted. Storage failures never block an authoritative action, and ordering never changes the current clicked/selected source identity.

## UI and accessibility

The accepted target is `.pi/artifacts/ui-mockups/inventory-source-selection/v002.png`.

- Exact sources appear before target and mechanical choices.
- Radio marks and `Selected` text make state non-colour-only.
- Arrow keys move among current sources; selection changes clear target choices.
- Source rows are at least 44 pixels high and reflow as one column.
- The inventory table marks the selected presentation row with `aria-current` and a restrained cyan signal edge.
- The UI states that selection and revision are rechecked on submission.

No raw authority identity is rendered as user-facing provenance.
