# Breeding baseline audit

Baseline source revision: `2177c1d57d8d206b6da5d9f70c8180c6f8cab462`  
Executable audit: `data/breeding-automation/baseline-audit.json`

## Existing state

At the baseline, SQLite schema version 21 has no breeding project, Pokémon Egg, consent, breeding roll/operation, campaign clock, or species-acquisition tables. The sheet store supports only Trainer and Pokémon documents.

Reusable infrastructure exists for:

- revisioned SQLite documents and caller-owned transactions;
- operation command hashes and exact-retry patterns;
- complete Pokémon/Trainer sheet persistence;
- durable post-commit realtime event logs;
- selected-profile and Trainer/Pokémon control policies;
- effective Ability, Capability, Edge, and Feature providers;
- canonical Breeder delegation through `breeding.v1`.

There is no Workshop route or role-specific breeding projection.

## Canonical-data findings

| Finding | Count |
| --- | ---: |
| Pokédex rows | 1,149 |
| Complete legacy-shape rows | 1,020 |
| Sparse rows | 129 |
| Rows without Egg Groups | 248 |
| Rows without hatch rate | 598 |
| Distinct raw Egg Group cell values | 19 |
| Unknown evolution target strings | 127 |
| Unknown evolution target references | 254 |
| Self-stage mismatch rows | 167 |
| Rows without Basic Abilities | 130 |
| Unknown Ability labels | 18 |
| Unknown Ability assignments | 44 |
| Unknown machine Move labels | 1 (`Facade`) |
| Affected machine compatibility rows | 947 |

These findings are diagnostics, not permission to infer repairs. The compiler must exclude or adjudicate each affected mechanic through app-owned, source-hash-bound artifacts.

## Existing compatibility fields

`CharacterSheet` permits editable Egg Groups, Egg Moves, inherited Moves, Gender, Nature, Abilities, and Baby Template state. Normalization materializes these fields, and sheet components edit them directly. They do not record parents, consent, source revisions, provider definitions, rolls, project state, Egg identity, or lineage.

The inherited-Move UI currently exposes Levels 20 through 90 and omits the Level 100 checkpoint. The reviewed ruleset freezes checkpoints through Level 100.

## Documentary generator

`ptu-data/generator.py` chooses zero to three random species Egg Moves for wild generation, uses process-local randomness, and applies inheritance checkpoints without parent snapshots or operation identity. Its emitter writes ordinary `eggMoves` and `inheritedMoves` fields. This path may continue producing wild-generation compatibility data but cannot create an Egg or breeding origin.

## Conflicting Egg authority

Capability automation currently discovers `map.metadata.capabilityEggs` and lets Egg Warmer mutate integer `hatchHours` through a map-scoped command. This violates the Workshop/campaign aggregate boundary.

The accepted migration is:

1. implement first-class Eggs and incubation;
2. adapt effective Egg Warmer into a typed breeding contribution;
3. route warming through replay-safe Egg operations;
4. migrate or explicitly discard synthetic map fixture state;
5. remove production reads/writes of `capabilityEggs` and `hatchHours`;
6. retain a checker that prevents reintroduction.

Map metadata never becomes import authority for durable Eggs.

## Missing authorities

- compiled breeding species/family registry;
- project and Egg aggregates;
- revision-bound consent;
- persisted breeding rolls and operations;
- campaign clock;
- acquisition history;
- atomic hatch use case;
- audience-specific projections;
- Workshop UI;
- breeding backup/restore contract.

## Baseline conclusion

No production path at the baseline can truthfully claim to breed, incubate, or hatch a Pokémon. Source governance and architecture are ready; durable semantics remain gated by the implementation ledger and checker.
