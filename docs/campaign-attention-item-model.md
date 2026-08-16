# Campaign attention-item model

P8-083 introduces the strict schema-v1 model used by later campaign continuation providers. An attention item is a current, authority-linked pointer to work. It is not a character, inventory, encounter, or Profile snapshot.

## Contract

Every `CampaignAttentionItem` contains exactly:

- a stable item identity and stable reason;
- an audience (`gm` or `owner`) and urgency;
- one affected entity identity;
- one immutable source-event identity and campaign minute;
- the exact authority kind, identity, and revision used to establish the work;
- an optional required-decision identity and kind;
- at most eight current legal actions, each with a stable identity, bounded intent, app-relative route, exact authority, and confirmation policy;
- a revisioned `open`, `resolved`, or `superseded` state; and
- the campaign minute at which the item was created.

The parser is exact and deeply freezes accepted records. Unknown fields, external routes, duplicate action identities, invalid chronology, partial terminal evidence, unsupported enums, and oversized values fail closed. There is no freeform summary, body, or action-label field; presentation copy is selected from the bounded reason and action-intent registries.

## Authority and privacy boundary

Attention items point to mutable authority by `(kind, id, revision)`. They do not contain names, levels, HP, Injuries, conditions, inventory quantities, build selections, Profile evidence, notes, operation commands, or document JSON. A consumer must reload and reauthorize the referenced authority before executing an action. The item and route are guidance, never a durable capability or trusted mutation template.

Open items retain at least one legal next action. Terminal items retain their reason, entity, source event, authority, and resolution evidence, but clear the required decision and legal actions so stale controls cannot remain executable.

## Settlement source provider

The initial provider projects durable `encounter_settlement_attention_sources` without introducing a second persistence ledger:

| Settlement reason | Urgency | Required decision | Action intent |
| --- | --- | --- | --- |
| `level-threshold` | normal | allocate advancement | review advancement |
| `advancement-review` | normal | allocate advancement | review advancement |
| `capture-review` | normal | review capture | review capture |
| `medical-review` | urgent | choose treatment | start treatment |
| `equipment-review` | normal | repair equipment | review equipment |
| `continuation-review` | informational | review continuation | continue campaign |

Item, decision, and action identities are deterministic SHA-256 derivations of the source identity. The immutable settlement history fact is the source event. Existing exact authority kinds are preserved rather than collapsed. Duplicate projected identities, malformed open/terminal source state, or more than 10,000 source records fail closed. Projection order is deterministic by urgency, creation minute, and item identity.

Resolved settlement sources project complete terminal evidence and no legal actions. Settlement IDs, finish-operation IDs, mutable character state, private plans, and source JSON are not copied into an attention item.

## Ordered follow-up

P8-084 through P8-088 add fresh authority-backed detectors and bounded workflows for advancement, move/ability/evolution choices, Trainer growth, medical recovery, captures, hatches, ownership, and equipment. P8-089 adds role/Profile-safe API and realtime projections. P8-090 renders those projections on the campaign continuation dashboard. Those tickets must consume this model rather than creating client-local attention bookkeeping.
