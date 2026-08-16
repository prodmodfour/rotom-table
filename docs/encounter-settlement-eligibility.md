# Encounter settlement eligibility and blocking gates

P8-072 defines the fail-closed policy that decides whether a version-1 encounter settlement draft may advance to `ready`. The private evaluator is [`server/domain/encounterSettlement/eligibility.ts`](../server/domain/encounterSettlement/eligibility.ts), and the reviewed contract is [`data/complete-play-loop/encounter-settlement-eligibility.v1.json`](../data/complete-play-loop/encounter-settlement-eligibility.v1.json).

## Complete current authority

Eligibility is not inferred from an empty browser view or from the settlement document alone. The server supplies one snapshot explicitly marked `authoritative-current` containing:

- the current Encounter Document identity and revision;
- the current linked-map identity and revision;
- the authoritative campaign minute;
- every current participant with exact map and sheet references;
- the complete current list of source-owned blocking facts.

Partial reads, duplicate source facts, unsupported resolutions, unknown participant references, malformed authorities, and over-limit lists fail closed. A caller cannot convert “repository was not read” into “there is no blocker.”

## Current blockers

The evaluator materializes stable, private gates for:

- required reactions;
- suspended resolutions;
- uncertain commands that require exact retry or reconciliation;
- unresolved private choices;
- contradictory or stale encounter, map, sheet, participant, owner, side, role, disposition, campaign-time, or revision evidence;
- invalid participant state and unsupported authority reported by a source-owned validator;
- pending reward allocation or capture destination;
- decision-required consequences and cleanup;
- explicit bounded GM adjudication.

A revision below the draft checkpoint is a contradiction, not freshness. A revision or campaign minute above the checkpoint makes the draft stale and requires refresh. Changed encounter/map identity, missing or unexpected participants, and changed participant identity also block.

Gate IDs are deterministic SHA-256 identities over the settlement, gate kind, and stable private source fact. Re-evaluation preserves the opening revision of a still-current gate and emits gates in deterministic identity order. The IDs and underlying source identities remain server-private.

## No implicit GM bypass

Only a gate whose current kind is `gm-adjudication` can be removed through adjudication. The recorded path must contain all of the following:

1. an accepted `gm-correction` decision with GM audience and GM actor evidence;
2. exactly one subject naming the current stable gate;
3. one selected option already present in the bounded option set;
4. a selected value that is one of the gate's current legal resolutions;
5. the matching effect: `correct`, `exclude`, or `waive` for `adjudicate`;
6. an exact selected-option authority that still appears on the current gate;
7. an accepted GM-only decision receipt naming both the decision and gate at the same authoritative campaign minute.

A GM role check by itself is insufficient. Prose, missing receipts, stale authority, forged options, or decisions aimed at required reactions, suspended resolutions, uncertain commands, private owner choices, revision conflicts, stale snapshots, invalid participants, unsupported authority, rewards, captures, or cleanup never remove those gates. Those sources must actually resolve through their owning contracts.

Resolved gate identities may remain in accepted decisions and receipts after leaving `unresolvedGates`. This is immutable audit evidence, not current blocking state.

## Outcomes

For an open draft:

- zero current gates produces `eligible: true` and next status `ready`;
- one or more current gates produces `eligible: false` and next status `blocked`.

A `committing` document remains committing and is never re-opened by evaluation. A completed or cancelled document remains terminal and is never declared eligible again.

The evaluator derives policy only. It does not mutate an encounter, map, sheet, inventory, capture, campaign clock, operation journal, or settlement repository. Later use cases must persist the refreshed gate set with revision checks and re-run eligibility at commit.

## Privacy

The input, derived gate authorities, source fact identities, decisions, and receipts are server-private. Later projections may expose safe blocker summaries, ownership, and legal next actions only. They must omit source identities and revisions, operation and receipt IDs, Profile principals, private option IDs, and GM correction evidence.
