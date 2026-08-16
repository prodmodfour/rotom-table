# Commerce and item-loop certification

P8-070 closes the Phase 7 inventory and commerce loop with one production-liveplay journey. The machine-readable acceptance contract is [`data/complete-play-loop/commerce-item-loop-certification.v1.json`](../data/complete-play-loop/commerce-item-loop-certification.v1.json).

## Certified journey

The browser fixture creates a current Profile-bound Trainer, controlled Pokémon, open shop, and live encounter, then completes this exact sequence:

1. A player buys two restorative items and one **Light Armor** into the Trainer's inventory.
2. The accepted checkout receipt supplies the exact continuation used to equip the armor.
3. Player and GM sheet clients both observe the reviewed **+5 Damage reduction** contribution.
4. The player uses one restorative from the encounter cockpit on the controlled Pokémon.
5. Trainer inventory, target HP, action consequences, and both encounter event feeds converge from the accepted item operation.
6. The remaining restorative transfers to shared inventory and disappears from both Trainer clients without a manual refresh.
7. Light Armor is unequipped, its contribution disappears, and the whole item returns to Trainer inventory.
8. Purchase, equip, item-use, transfer, and unequip facts appear in player-readable history.

Desktop uses **Potion** and mobile uses **Super Potion**, exercising two canonical restorative settlements while keeping the equipment path identical.

## Authority and exact replay

Every mutation remains with its existing server-owned use case. The browser submits only current Profile authority, exact accepted source or continuation identity, bounded choices, and expected revisions.

The fixture captures and resubmits the exact accepted command for checkout, equip, encounter use, Trainer-to-group transfer, and unequip. Each replay returns the terminal result without changing money, stock, quantity, HP, equipment, group inventory, or any affected revision a second time.

A successful journey requires all of the following:

- checkout continuation comes from the accepted delivery rather than an item-name lookup;
- item use settles source inventory and target HP together;
- equipment custody and effective contributions appear and withdraw together;
- Trainer and shared-inventory transfer writes converge together;
- direct player and GM loads end on equal Trainer, Pokémon, and shared-inventory revisions;
- no browser requires a manual reload to observe accepted state.

## Projection and hydration guarantees

P8-070 also certifies the outer live-sheet boundary used by the journey:

- GM list projections and direct sheet loads carry equivalent equipment and contribution projections;
- both paths strip private equipment fields;
- an expected access-scope supersession may end a best-effort background load silently, while explicit reconciliation still fails closed;
- styled title tooltips wait until page hydration has completed before mutating server-rendered attributes;
- the empty legacy Trainer class placeholder is no longer mounted into a different client-only hydration shape.

These guarantees prevent stale outer shells, duplicate reload diagnostics, and production hydration errors from masking otherwise-correct inventory state.

## Accessibility, responsive behavior, and privacy

The same journey runs in desktop Chromium and mobile Chromium. It requires:

- zero scoped Axe violations on checkout continuation, encounter decision, Trainer history, and shared inventory;
- no page horizontal overflow beyond one pixel of browser rounding;
- no console warning, console error, or uncaught page error;
- responsive checkout receipts, encounter decisions, history, and shared-inventory cards;
- no visible Profile IDs, operation or source identities, stable row IDs, equipment-instance IDs, or hashes.

Only safe Profile and character display labels, item and container labels, presentation rows, quantities, costs, targets, slots, consequences, and accepted summaries may appear.

## Evidence and rerun

The automated journey is [`tests/e2e/commerce-item-loop-certification.spec.ts`](../tests/e2e/commerce-item-loop-certification.spec.ts). Its accepted screenshots and report are under `.pi/artifacts/ui-validation/commerce-item-loop/`.

Run the bounded static certification with:

```bash
npm run check:complete-play-loop-commerce-item-loop
```

For browser acceptance, build the production app, launch it against a clean temporary campaign root with hosted writes and session hosting enabled, then run:

```bash
P8070_UI_ARTIFACT_DIR=.pi/artifacts/ui-validation/commerce-item-loop \
  npx playwright test tests/e2e/commerce-item-loop-certification.spec.ts \
  --config=playwright.p8070-reuse.config.ts
```

The temporary reuse config is an execution aid only and is removed after the ticket is accepted. Certification never depends on direct JSON, SQLite, HP, equipment, or inventory repair.
