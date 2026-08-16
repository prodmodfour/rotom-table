# Encounter settlement reward packages and allocation rules

P8-074 defines the private reward-package preflight used before any settlement mutation. The planner is [`server/domain/encounterSettlement/rewardPackage.ts`](../server/domain/encounterSettlement/rewardPackage.ts), and the reviewed policy is [`data/complete-play-loop/encounter-settlement-reward-package.v1.json`](../data/complete-play-loop/encounter-settlement-reward-package.v1.json).

## Reward lines

One package may contain:

- Experience;
- money;
- stackable items;
- one whole serialized equipment item per serialized line;
- one accepted captured Pokémon reference;
- bounded narrative facts.

A GM note is a narrative line with `gm` visibility. It remains server-private and cannot become hidden mechanics. Narrative facts and notes use bounded accepted text and source authority; they do not parse prose into a mutation.

Every non-excluded line stays present until its complete declared amount is allocated and every write passes preflight. Missing or invalid allocation never makes a reward disappear.

## Destinations and methods

Allocations support conceptual group, encounter-side, participant, and Profile destinations as well as exact Trainer inventory, Pokémon sheet, and group-inventory destinations. Conceptual destinations expand to source-owned leaf writes during preflight.

The closed rules are:

- Experience: group, side, participant, or Pokémon sheet; fixed, weighted, or individual;
- money: group, side, participant, Trainer inventory, or group inventory; fixed, weighted, or individual;
- items: group, side, participant, Trainer inventory, or group inventory; fixed or whole;
- captures: participant or Profile; whole only;
- narrative facts: group, side, participant, or Profile; whole only.

Non-excluded allocation amounts must total exactly the reward amount or quantity. Capture and narrative have an exact logical amount of one. A `whole` allocation must be the only active allocation for that line and carry its complete amount. Serialized equipment and captures require exactly one amount-one write with capacity cost one.

P8-075 and later tickets calculate specialized distribution mechanics. P8-074 validates only the complete declaration and provider-generated writes; it does not invent an XP split, stack merge, team destination, or campaign outcome.

## Complete destination authority

The server supplies one `authoritative-current` destination read for every active allocation destination and no foreign destination. Each unique destination has:

- exact kind, identity, and revision;
- a source-authority-backed allowed or denied permission result;
- a stable private denial reason when denied;
- one bounded capacity model;
- every leaf write for every allocation aimed there.

Supported capacity models are unbounded, quantity, slots, team slots, and fact slots. The planner sums capacity costs across all writes to the destination before comparison. Two individually valid allocations cannot overfill a destination together.

A destination revision mismatch is stale. Missing authority, denied permission, unsupported destination, or aggregate overflow remains a visible validation issue and leaves the reward pending.

## Complete write preview

Every active allocation has at least one private leaf write. A write names:

- one stable private source-write identity;
- the allocation it implements;
- an exact target authority and revision;
- one owned field: Experience, money, stack inventory, serialized equipment, capture destination, or narrative fact;
- a non-negative amount and an explicit marker saying whether it contributes to the allocation total;
- non-negative capacity cost;
- deterministic next aggregate revision.

Positive contributing write amounts must sum exactly to their allocation. A source-owned related aggregate mutation—such as clearing the other side of a level-triggered relationship—may be previewed only as an explicit non-contributing zero-amount write. The field must match the reward payload. Duplicate source writes and duplicate target-field writes inside one allocation are rejected. Target authority kinds are closed by field, so a capture operation cannot masquerade as a money or inventory owner.

This preview is not an executable command and carries no capability. P8-075 through P8-078 re-read and calculate their mechanics, and P8-080 commits all accepted writes atomically.

## Readiness

A package is eligible only when every non-excluded line is allocated, every active allocation is ready, permissions and revisions are current, aggregate capacity fits, and every write preview is complete. Any issue leaves the affected allocation `proposed`, the line `pending`, and the package non-eligible. An empty package is ready without writes.

Committed or cancelled packages, committed lines, applied allocations, and settlements already committing or terminal cannot be re-planned.

## Privacy

The plan is server-private. Public projections must omit destination revisions, permission authorities and private denial identities, raw capacity values, source-write IDs, target authority, Profile identities, and GM-only note text. A role-safe projection may expose labels, quantities, audience-correct narrative, capacity outcome, and actionable disabled reasons.
