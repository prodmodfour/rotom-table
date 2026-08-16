# Encounter settlement money and item loot allocation

P8-076 provides one server-owned planner for settlement money, item stacks, and serialized equipment. The runtime is [`server/domain/encounterSettlement/lootAllocation.ts`](../server/domain/encounterSettlement/lootAllocation.ts), with reviewed evidence in [`data/complete-play-loop/encounter-settlement-loot-allocation.v1.json`](../data/complete-play-loop/encounter-settlement-loot-allocation.v1.json).

## Current authority

Planning requires one `authoritative-current` snapshot. Every declaration names one current reward, one exact Trainer or group-inventory destination and revision, a positive amount, and source-backed permission. Item declarations additionally carry the reward package's exact definition authority and a server-owned canonical inventory template.

The planner requires only declared destination containers and verifies document identity, current revision, safe money balance, unique row IDs, and unique serialized-equipment identities. Blank or unsupported destinations, duplicate reward/destination declarations, stale containers, inconsistent permissions, incomplete reads, unsafe integers, and undeclared containers fail closed. Browser labels, balances, rows, and ownership claims have no authority.

## Money allocation

A money line may be split among Trainer and group inventories. Positive declaration amounts must sum exactly to the reward. Each current non-negative safe-integer balance is incremented in deterministic allocation order; overflow rejects the plan.

Every contribution becomes a reward-package leaf write against the exact sheet or group-inventory revision. Money consumes no inventory capacity. Multiple contributions to one container still produce one aggregate next-container revision.

## Stack allocation

A stack line can be split among exact destinations. The row template must retain the exact canonical item identity and matching reward definition authority. Runtime mechanics do not infer identity or behavior from a display name or description.

The planner reuses the inventory runtime's merge predicate. Existing rows merge only when canonical alias identity and all structured merge fields—cost, description, modifier, slot, and item variant—match. A merge preserves the existing row ID and adds the quantity with safe-integer checks. Otherwise the planner creates a deterministic row ID bound to settlement, reward, and destination.

Every section remains bounded to 256 rows. Duplicate row IDs across any section, occupied deterministic IDs, malformed variants, and unsafe merged quantities reject the whole plan.

## Serialized equipment

A serialized reward is one indivisible unit in the equipment section. It must have:

- reward quantity and declaration amount exactly one;
- the exact canonical item identity;
- whole-item revision zero;
- a reviewed equipment-definition hash;
- valid bounded activity and state;
- a deterministic `equipped-item:v1` identity derived from settlement and reward identity.

The whole-item ID is checked across every inventory section, so replay or conflicting custody cannot duplicate equipment. Serialized rows never merge and always consume one slot.

## Pending, denied, and excluded lines

A non-excluded line without declarations stays pending. Under-allocation, over-allocation, or invalid whole-item distribution also remains non-committable. A denied destination retains its proposed allocation and private permission evidence but produces no mutation. Explicit exclusion requires no allocation. Existing foreign allocation evidence is not silently replaced.

`complete` is true only when every non-excluded money and item reward is conserved exactly through allowed declarations. The application guard refuses every incomplete plan, ensuring pending rewards cannot disappear when encounter settlement closes.

## Revision-bound application

Each changed container receives one private write plan containing expected and next revision, stable-JSON SHA-256 before and after evidence, and the exact source-derived next document. Application rechecks all of that authority before returning any applicable write. One changed hash rejects the entire set.

P8-076 does not persist individual rewards. P8-080 owns the transaction that commits complete XP, loot, captures, cleanup, history, and settlement evidence together.

## Privacy

Container documents and hashes, inventory row IDs, serialized instance IDs, definition and permission evidence, write IDs, and ownership proof remain server-private. A later role projection may expose safe destination labels, allocated amount, money before/after, merged-versus-created status, capacity outcome, and pending or denied state. It must not expose private identities or inventory contents.
