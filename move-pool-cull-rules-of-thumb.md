# Move-Pool Cull Rules of Thumb

## Purpose

This document records the cumulative rules of thumb used to cull Pokémon level-up move pools for the Level 1–20 redesign.

The process is iterative:

1. A cull rule of thumb is added.
2. Every recorded rule is applied cumulatively to every `level_up_moves` list in the authoritative `data/reference/pokedex.json` dataset.
3. The resulting list lengths are counted directly rather than estimated.
4. The audit succeeds only when every resulting level-up move pool contains at most 20 moves.

It is acceptable for a rule to turn a 20-move pool into a short move pool. Cull rules only remove moves; they never add moves to a species' pool.

## Audit conventions

- “Move pool” means the `level_up_moves` list, not TM/HM, Egg, or Tutor compatibility.
- Each Pokédex species or form entry is audited independently.
- Pokémon types come from the entry's `types` field.
- Move types come from each level-up move's `type` field.
- A Pokémon “has a Dragon-type Mega Evolution” only when that species directly Mega Evolves into a form containing the Dragon type. Under the PTU Pokédex represented by this project, the non-Dragon species satisfying that exception are **Charizard**, **Ampharos**, and **Sceptile**. Their pre-evolutions do not directly Mega Evolve and therefore do not receive the exception.
- Passing the size audit means only that a pool contains at most 20 moves. It does not establish that an empty or unusually short source pool is complete or otherwise correct.
- These audits simulate the cumulative rules against canonical source data; they do not mutate `pokedex.json` while the rules are still being designed.

## Cumulative cull rules

### Rule 1: Dragon moves require a Dragon identity

Only a Dragon-type Pokémon or a Pokémon with a Dragon-type Mega Evolution may have Dragon-type moves.

Operationally, remove every Dragon-type move from a Pokémon's level-up move pool unless either:

1. `Dragon` appears in the Pokémon's own type list; or
2. the Pokémon is Charizard, Ampharos, or Sceptile.

This rule only permits an eligible Pokémon to retain Dragon moves already in its pool. It never grants a Dragon move.

## Exact cumulative audit

### After Rule 1

The unculled dataset contains 1,149 species/form entries. Before applying any rules:

- 1,137 pools contain fewer than 20 moves;
- 7 pools contain exactly 20 moves; and
- 5 pools contain 21 moves.

Rule 1 removes exactly **49 level-up move entries from 38 species/form entries**. Among the five oversized pools, it removes **Dragon Breath** from Onix, reducing Onix from 21 moves to 20. It removes no moves from the other four oversized pools.

Resulting size distribution:

- 1,137 pools contain fewer than 20 moves;
- 8 pools contain exactly 20 moves; and
- 4 pools still contain 21 moves.

The remaining oversized pools are:

| Species/form | Moves after cumulative rules | Amount over cap |
|---|---:|---:|
| Whimsicott | 21 | 1 |
| Tauros Aqua Breed | 21 | 1 |
| Tauros Blaze Breed | 21 | 1 |
| Tauros Combat Breed | 21 | 1 |

**Audit result: not yet successful.** Four move pools still exceed 20 moves.

## Audit history

| Rules applied | Move entries removed | Pools over 20 | Largest remaining pool | Result |
|---:|---:|---:|---:|---|
| 1 | 49 | 4 | 21 | Not successful |
