# Complete Play Loop accessibility, responsive, and visual acceptance

P8-096 consolidates accepted production-liveplay evidence for item/inventory, equipment/item use, Finish Encounter settlement, and Campaign continuation. The machine-readable matrix is `data/complete-play-loop/accessibility-responsive-visual-acceptance.v1.json`.

No new mockup was generated. The UI design workflow was loaded, but this ticket audits already accepted designs and adds only the exact existing 80-row pagination pattern to preserve semantic-table performance. There was no unresolved hierarchy, composition, or visual-language choice for an image mockup to answer.

## Acceptance result

**Accepted — 9.8/10, no hard failure and no critical usability debt.**

The matrix covers keyboard, screen-reader semantics, touch targets, effective 200% zoom, 320-pixel reflow, contrast, reduced motion, table-distance readability, desktop, and mobile. Evidence comes from four independently accepted production-liveplay journeys, each run in package-pinned desktop and mobile Chromium, plus current component, token, and contract checks.

## Shared interaction requirements

- Inventory remains one semantic table. Narrow presentation uses CSS grid/card reflow; it does not replace headers or rows with a second DOM.
- Large inventories page 80 rows while exposing complete `aria-rowcount`, global `aria-rowindex`, a labelled navigation region, and polite range updates.
- Inventory tabs retain roving Arrow/Home/End behavior. Editable cells and source choices retain Enter/Space activation and Escape focus return.
- Decisions and Finish Encounter preserve initial focus, focus trapping, cancellation/origin restoration, and accepted-state fallback when an originating row disappears.
- Approximately 44-pixel controls remain the target; browser rounding may measure 43.5 pixels.
- Selection includes text and shape, not cyan alone. Destructive commitment includes explicit irreversible copy and confirmation, not red alone.
- `prefers-reduced-motion: reduce` removes nonessential transitions and choreography.
- The page does not exceed one pixel of horizontal overflow at 320 CSS pixels.

## Contrast and table-distance

`data/encounter-workspace/design-tokens.v1.json` is tested with the WCAG relative-luminance formula. Every declared text pair meets 4.5:1 and every focus/non-text pair meets 3:1 in dark and light themes.

Table-distance acceptance uses Atkinson Hyperlegible for interface text, EB Garamond only for book/display hierarchy, JetBrains Mono for bounded numeric/meta data, high-contrast matte surfaces, persistent state labels, and the 1280-pixel desktop evidence. Dense meta text never carries the only action or state explanation.

## Surface evidence

### Item and inventory

The P8-069 journey certifies semantic headers/row headers, roving tabs, exact source selection, editable-cell focus, decision focus return, 43.5-pixel minimum controls, reduced motion, Axe zero, 412/320 reflow, and no overflow. P8-096 adds current 5,000-row pagination semantics.

### Equipment and item use

The P8-070 commerce journey certifies checkout, exact equip/unequip, visible contribution arithmetic, encounter item decisions, history, shared inventory, player/GM convergence, Axe zero, and desktop/mobile reflow without private identities.

### Finish Encounter settlement

The P8-082 journey certifies title focus, focus trap, keyboard-scrollable review, 44-pixel controls, reduced motion, effective 200% reflow at 320 pixels, player-role exclusion, privacy, and the accepted atomic result.

### Campaign continuation

The P8-090 journey certifies recommendation-first hierarchy, 2:1 desktop composition, one-column mobile/320 composition, full-width mobile actions, visible keyboard focus, Axe zero, and privacy-safe whole-snapshot replacement.

## Running the gate

```bash
npm run check:complete-play-loop-accessibility-visual
```

The gate checks current semantics and contrast, verifies every evidence SHA-256, runs the established focused accessibility package, and remains part of `scripts/quality-gate.sh`. Browser artifacts are immutable evidence from their production-liveplay journeys; changing their specs, reviews, screenshots, or owning UI invalidates this certification until reviewed again.
