# Permanent advancement items

P8-053 makes the following Trainer-owned inventory rows authoritative item actions:

- HP Up, Protein, Iron, Calcium, Zinc, and Carbos
- Heart Booster
- PP Up
- Rare Candy
- Stat Suppressants

The reviewed runtime contract is `data/complete-play-loop/permanent-advancement-items.v1.json`. Runtime mechanics come only from the hash-bound records in `data/reference/items.json` and `data/reference/rules.json`; the cited book excerpt is migration evidence, not a runtime input.

## Liveplay workflow

1. Open a Trainer sheet and select **Inventory** → **Pokémon Items**.
2. Choose **Use** on a supported row.
3. Select one owned Pokémon.
4. For PP Up, select one currently eligible Move. For Stat Suppressants, select one legal Base Stat and explicitly confirm Trainer consent.
5. Review the permanent before/after facts and choose **Start Extended Action**.
6. Starting stores the exact target and choices but does not change the sheet or consume inventory.
7. Choose **Complete Extended Action** to revalidate and atomically apply the permanent change, consume one item, record provenance, publish updates, and complete the activity.
8. **Interrupt safely** ends the activity without mechanics or consumption.

A reconnect restores the durable activity. An exact retry returns the stored result and does not apply or consume twice.

## Canonical limits

- The six Base-Stat Vitamins, Heart Booster, and PP Up share a five-Vitamin lifetime limit per Pokémon.
- Each Base-Stat Vitamin raises its named effective Base Stat by 1.
- Heart Booster grants 2 Tutor Points and can benefit a Pokémon once.
- PP Up can benefit a Pokémon once. At-Will Moves are ineligible; EOT becomes At-Will; Scene and Daily frequencies gain one use.
- Rare Candy sets total Experience to the exact next-Level threshold, is unavailable at Level 100, and can benefit a Pokémon five times.
- Stat Suppressants do not consume a Vitamin slot. They reduce one selected Base Stat by 1 only when the owning Trainer explicitly consents.

The server rejects no-ops, stale Move choices, exceeded limits, a Base Stat below 1, invalid Base Relations, an exceeded added Stat Point budget, inconsistent Level/Experience, overspent Tutor Points, malformed state, or a changed ownership/source/definition read set. Rejected completion leaves the activity in progress and writes nothing.

## Sheet and privacy boundaries

Accepted permanent outcomes continue to feed the ordinary Pokémon derived-stat, Tutor Point, Move, and Experience paths. Item-controlled Vitamin fields are read-only in setup saves; notes and Heart Scale tracking remain editable.

Raw permanent-advancement provenance is stored under `CharacterSheet.serverPrivate.itemPermanentAdvancement`. Player and GM sheet projections, realtime events, and UI must not expose source operation IDs, definition hashes, source-row IDs, ownership evidence, or opaque choice internals.

## Recovery and diagnosis

- If completion reports stale authority, refresh the Trainer inventory and inspect the current source, target, Move, limits, and activity revision.
- Do not manually decrement inventory or edit permanent fields after a failed completion.
- If stored provenance is malformed, mechanics fail closed. Repair requires a reviewed server-side migration rather than a setup-sheet edit.
- The active activity may be interrupted safely if the table no longer wants to complete it.
