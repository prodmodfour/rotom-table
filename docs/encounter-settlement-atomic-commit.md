# Atomic encounter settlement commit

P8-080 composes the settlement providers from P8-075 through P8-079 and persists their accepted result through [`server/domain/encounterSettlement/atomicCommit.ts`](../server/domain/encounterSettlement/atomicCommit.ts), [`server/storage/encounterSettlementRepository.ts`](../server/storage/encounterSettlementRepository.ts), and [`server/useCases/commitEncounterSettlement.ts`](../server/useCases/commitEncounterSettlement.ts). The reviewed contract is [`data/complete-play-loop/encounter-settlement-atomic-commit.v1.json`](../data/complete-play-loop/encounter-settlement-atomic-commit.v1.json).

## Explicit commit boundary

A commit command is strict schema v1. It contains only:

- one stable operation identity;
- the exact settlement identity and expected revision;
- the SHA-256 of a server-owned prepared plan; and
- `confirmed: true` from the explicit GM confirmation boundary.

Unknown fields, implicit confirmation, malformed identities, uppercase or malformed hashes, unavailable plans, and non-GM callers fail before transaction work. The command never carries client-authored sheet, inventory, map, reward, cleanup, or outcome patches.

## Complete composed plan

Commit accepts only complete plans for all five domains:

1. batch Experience allocation;
2. money and item loot allocation;
3. capture settlement;
4. structured outcomes and campaign consequences; and
5. temporary-state cleanup plus the authoritative encounter-end lifecycle.

Each component must have been planned from the same settlement identity and revision. Experience, loot, and capture own only allocation changes. Outcomes own only persistent-consequence changes. Cleanup cannot rewrite orchestration fields. A component that changes anything outside its owned domain invalidates the whole plan.

The merged allocations and destination writes are run through the P8-074 reward-package validator again. The resulting document is then run through the P8-072 complete-current eligibility evaluator. An incomplete provider, pending reward, proposed terminal work, unresolved gate, denied authority, or missing lifecycle result exposes no committable aggregate.

## One revision per aggregate

Several providers may legitimately target the same sheet. For example, Experience can change level and total Experience while cleanup resets Combat Stages. P8-080 performs a deterministic three-way merge from one exact previous document:

- disjoint leaf changes compose into one sheet successor revision;
- an unchanged provider leaf does not overwrite another provider;
- two equal changes deduplicate; and
- divergent changes to one leaf fail closed.

The same exact before/after hash discipline applies to group inventories, the map, and the Encounter Document. The final settlement successor applies accepted consequence, reward, allocation, cleanup, receipt, and completion evidence at one campaign minute.

This aggregation does not turn settlement into a broad sheet rewrite. HP, injuries, persistent conditions, inventory or equipment not explicitly awarded, and unrelated durable advancement remain unchanged.

## Locked complete authority

The SQLite repository enters `BEGIN IMMEDIATE` and checks for exact terminal replay first. For a new operation it rebuilds the complete authority snapshot while holding the write lock. That snapshot includes:

- the settlement document;
- participant revisions and all eligibility facts;
- all consulted sheet and group documents;
- the linked map and Encounter Document;
- reward destination writes, permissions, and capacity evidence; and
- the current campaign minute.

The complete snapshot must reproduce the prepared authority hash. The repository also verifies each touched document's exact revision and before hash. Any drift rejects the whole command before its first durable successor. There is no row-scoped rebase at settlement completion.

## Single SQLite transaction

One synchronous transaction writes, in order:

1. the Encounter Document successor;
2. the map successor when cleanup changes it;
3. one merged successor for each changed sheet;
4. one successor for each changed group inventory;
5. the terminal settlement successor;
6. accepted operation evidence;
7. immutable history facts; and
8. open attention sources.

Normal map, sheet, group, and Encounter Document repositories still own document normalization. After each write, P8-080 reloads or consumes the normalized successor and verifies the exact planned after hash. A normalization difference is a transaction failure, not an invitation to accept a nearby state.

No promise, network call, realtime publication, or browser step may occur inside the transaction callback. A failure after any individual write, including immediately before `COMMIT`, rolls back every prior document revision and all operation, history, and attention rows. The repository test injects a failure at every generated boundary to certify this behavior.

## Storage schema 42

Migration 42 adds four tables:

- `encounter_settlements` — one revisioned canonical settlement document per encounter;
- `encounter_settlement_operations` — strict command, private full-plan evidence, authority hash, and exact accepted result;
- `encounter_settlement_history_facts` — immutable, structured, audience-scoped facts; and
- `encounter_settlement_attention_sources` — open or resolved authority-linked continuation sources.

The accepted operation evidence is private. It may contain operation identities, revisions, definition hashes, stable source identities, and complete server documents. Those values are not a public or player projection. P8-081 owns redacted role projections and realtime publication.

## History and attention seeds

The transaction records bounded facts for Experience, loot, captures, outcomes, cleanup, and completion. Facts use closed result codes and explicit audiences; a freeform note never becomes mechanics merely because it appears in history.

Crossing a canonical Experience threshold creates an owner-scoped `level-threshold` attention source. It points to the committed Experience fact and exact successor sheet authority. It does not copy mutable character state and does not choose stats, moves, abilities, features, or evolution outcomes. P8-083 and later tickets turn these sources into guided attention items.

## Exact terminal replay

The operation lookup precedes current-authority and terminal-state checks. The same operation identity, command hash, and principal returns the stored accepted result exactly, without rerunning planning, mechanics, rolls, or writes. Because the result is in SQLite, this guarantee survives process restart.

Reusing an operation identity with another command or principal fails closed and does not reveal the prior result. A completed, committing, cancelled, or otherwise terminal settlement cannot be committed as new work under another operation identity. Stale commands require a new complete preview and explicit confirmation.
