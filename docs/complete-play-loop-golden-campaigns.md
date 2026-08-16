# Complete Play Loop golden campaigns

P8-098 certifies three complete campaign lineages in `data/complete-play-loop/golden-campaign-acceptance.v1.json`.

Each lineage includes:

1. acquire;
2. transfer;
3. equip or use;
4. encounter;
5. capture;
6. Finish Encounter;
7. reward settlement;
8. advancement decisions;
9. treatment and recovery;
10. reviewed next day;
11. next scene from fresh authority.

Every lineage includes GM and current player-owner projections. Fixture setup uses public setup-edit APIs wherever available. The Finish Encounter browser harness has one reviewed pre-journey `seedSettlementDraft` INSERT because no public draft-authoring route exists; it is deterministic setup, occurs before the first runtime command, and cannot update or repair an outcome. After a journey starts, acceptance may not edit SQLite, campaign JSON, repository rows, operation journals, inventories, or sheets. Runtime transitions use the same liveplay commands and APIs as the product.

## Canonical fixture coverage

The three campaigns partition every fixture in:

- `data/complete-play-loop/fixtures/items.v1.json` — 16 item fixtures;
- `data/complete-play-loop/fixtures/settlements.v1.json` — five settlement fixtures.

No fixture is omitted or counted twice. Canonical item records are re-hashed against `data/reference/items.json`. Settlement fixtures retain exact-terminal retry expectations.

### Restorative and capture campaign

Covers restorative healing, condition removal, revival, capped combat stages, food, shop acquisition, and Wonder Launcher delivery through an ordinary duel. It proves purchase/transfer/use continuity, exact capture authority, settlement, and downstream recovery.

### Equipment, loot, and advancement campaign

Covers Trainer equipment, held-item source loss, vitamins, PP Up, Rare Candy, consent-bound Stat Suppressants, capture overflow, stacked loot, and serialized equipment identity. It proves that settled Experience and capture evidence create role-scoped advancement/roster work rather than hidden sheet edits.

### Injury and reconnect campaign

Covers shared-inventory concurrency, First Aid Kit, Bandages, injury-heavy consequences, and reconnect during settlement. It proves reviewed treatment, blocker-aware next-day preflight, retained-command status recovery, and next-scene loading from current authority.

## Production-liveplay continuity

The golden contract composes immutable desktop/mobile production-liveplay evidence from commerce/item use, Finish Encounter, Campaign continuation, and Campaign-day continuation. These journeys collectively exercise both roles, zero Axe violations, responsive presentation, exact replay, and no storage repair. Server and integration evidence fills the capture and all canonical fixture branches that are deliberately not multiplied into browser-only catalog tests.

Run the focused gate:

```bash
npm run check:complete-play-loop-golden-campaigns
```

The gate verifies exact fixture partitioning and record hashes, rejects direct-storage techniques in browser journeys, checks every phase and role, validates all SHA-256 evidence, and runs representative real transaction suites for the full lineage.
