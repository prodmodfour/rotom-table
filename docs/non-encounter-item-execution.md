# Non-encounter item execution

Rotom Table uses the same `ItemSpec`, eligibility, deterministic plan, reducer, operation journal, receipt, correction, and realtime machinery both inside and outside encounters. A map is not fabricated as authority for sheet, campaign, workshop, or Extended Action use.

## Authoritative context

Every newly declared non-encounter operation reads the singleton campaign clock and stores its exact revision and campaign minute with the immutable operation plan. It also stores:

- the exact actor sheet and revision;
- each eligible target sheet and revision;
- the server-derived target relationship (`actor`, `actor-roster`, `profile-control`, or `gm-override`);
- the Extended Action phase and durable activity identity, when applicable; and
- bounded GM-confirmation status and opaque evidence identity, when required.

The browser submits only a current declared offer, opaque target/choice identities, an operation ID, and expected revisions. It cannot assert ownership, campaign time, progress, confirmation, mechanics, or outcome values.

## Target ownership

A player may target their actor, a Pokémon on the actor's unambiguous Trainer roster, or another sheet currently linked to their selected profile. Duplicate Trainer roster ownership fails closed. A GM may authorize another target, but that override is recorded in the private immutable plan evidence. Public and player-safe projections never expose roster-owner slugs, profile IDs, source rows, or raw context evidence.

## Extended Actions

An item with Extended Action timing has three explicit phases:

1. `declaration` — the action has not started and mechanics cannot resolve;
2. `in-progress` — durable work exists but is not complete; and
3. `completion` — an exact activity identity and revision authorize one resolution.

Only completion may apply effects, pay completion-phase costs, or consume completion-phase inventory. P8-052 implements this boundary for treatment in [`medical-extended-actions.md`](medical-extended-actions.md), and P8-053 uses the same authority for [`permanent-advancement-items.md`](permanent-advancement-items.md). Direct `/api/items/use` commands cannot bypass durable activity authority.

## GM confirmation

A typed ItemSpec prerequisite determines whether confirmation is required. The runtime records only status and an opaque evidence identity; freeform GM notes are not mechanics. Missing or stale confirmation blocks resolution.

## Recovery and replay

Campaign clock, actor, targets, inventory, and any activity revision are revalidated in the transaction. Exact retries return the stored terminal result and never reroll, repay, reconsume, or recreate confirmation. A changed read invalidates the original command rather than silently generating a new one.

The machine-readable runtime contract is `data/complete-play-loop/non-encounter-item-context.v1.json`. The P8-060 cross-workflow acceptance index and restart boundary are documented in [`out-of-encounter-item-certification.md`](out-of-encounter-item-certification.md); that index is evidence only and grants no runtime mechanics.
