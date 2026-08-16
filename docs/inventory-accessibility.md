# Responsive and accessible inventory interactions

P8-069 keeps Trainer and shared inventory usable by keyboard, touch, screen reader, zoom, and narrow-screen reflow. It changes presentation and focus behavior only; every item, equipment, transfer, stack, recovery, Extended Action, and exploration mutation still uses its existing server-authoritative command path.

## Responsive inventory rows

Wide layouts retain a native semantic table. At 760 CSS pixels and below, the same table rows reflow visually into matte cards. The DOM remains a table with column headers and one row header, while visible labels repeat **Name**, **Qty**, **Slot**, **Cost**, **Mod**, **Description**, and **Actions** as applicable.

A selected exact source includes all three cues:

- a cyan signal spine or outline;
- the visible text **Selected source**; and
- machine-readable current/selected state.

Row actions wrap without hiding Use, Equip, Give, Transfer, Inspect, Split, Merge, or Discard. At the narrowest layout they form two readable columns before the decision card. The decision follows the source row in document order; accepted activity remains secondary below it. No inventory workflow requires horizontal page scrolling at a 320 CSS-pixel viewport, the reflow equivalent of 400% zoom on a 1280-pixel layout.

## Keyboard behavior

### Sheet and inventory navigation

Sheet-level navigation and inventory section tabs use one roving tab stop:

- `Arrow Right` or `Arrow Down` activates the next entry;
- `Arrow Left` or `Arrow Up` activates the previous entry;
- `Home` activates the first entry; and
- `End` activates the last entry.

Inventory sections expose a tablist and matching tabpanel. Exact source choices use the same arrow, Home, and End behavior in a radio group.

### Inline editing

Focus an editable inventory value and use:

- `Enter` or `Space` to open its input;
- `Enter` to commit a single-line value;
- `Ctrl+Enter` or `Command+Enter` to commit a multiline value;
- `Escape` to restore the value from the beginning of the edit; or
- `Tab` to commit on blur and continue in normal document order.

Keyboard commit and cancellation return focus to the same labelled field trigger. Adding a row moves focus into the new row when it is available. Removing an editable row moves focus to the next row or the section’s **Add row** control, and both changes are announced politely.

### Decisions and recovery

Opening an item or inventory decision moves focus to its heading. Cancel or accepted-result dismissal returns focus to the originating row action when it still exists. If the accepted mutation removed or moved that row, focus returns to the active inventory section tab. Recovery and equipment result cards preserve their existing blocking and announcement behavior.

## Touch and screen readers

Primary controls target at least 44 pixels in height, including sheet and section navigation, inline editors, row actions, source and quantity inputs, confirmation rows, decision actions, equipment controls, recovery controls, and history refresh.

Editable triggers and active inputs name both the field and its safe item label. Disabled row actions include a concise unavailable reason in their accessible name rather than depending on hover text. Reservation, conflict, error, pending, accepted, and uncertain states retain textual status or alert regions.

Quantity, source, target, cost, selection, and destructive effects never depend on color alone. Discard keeps the **Discard** label and icon, **Irreversible** heading, exact permanently removed quantity, explicit confirmation, and danger treatment. Cyan remains reserved for focus and selection.

## Reduced motion

When `prefers-reduced-motion: reduce` is active, decorative transitions on sheet navigation, section navigation, inline edit triggers, and item-name edit triggers are removed. No required inventory information depends on motion.

## Privacy and authority

Responsive labels may show only safe container, section, presentation-row, item, quantity, target, cost, and consequence text already present in authorised projections. They never render operation or request IDs, Profile IDs, stable row or instance IDs, revisions, hashes, raw commands, ownership evidence, or private notes.

Reflow, focus restoration, and accessibility labels do not create mutation authority. The browser still waits for accepted server results before changing durable inventory or effective equipment state.

## Validation

Run the bounded component and contract certification with:

```bash
npm run check:complete-play-loop-inventory-accessibility
```

The liveplay browser acceptance additionally checks desktop and mobile keyboard paths, 44-pixel targets, semantic tables, 320-pixel reflow, reduced motion, Axe results, focus restoration, console status, privacy, and horizontal overflow.

The selected visual target is `.pi/artifacts/ui-mockups/inventory-accessible-reflow/v001.png`, scored 10/10. The machine-readable contract is `data/complete-play-loop/inventory-accessibility.v1.json`.
