# Encounter settlement document v1

P8-071 introduces the private, revisioned orchestration document used by the Finish Encounter workflow. The runtime parser and types are in [`shared/encounterSettlement/document.ts`](../shared/encounterSettlement/document.ts); the reviewed contract is [`data/complete-play-loop/encounter-settlement-document.v1.json`](../data/complete-play-loop/encounter-settlement-document.v1.json).

## Boundary

A settlement document is **not** a second encounter, map, sheet, inventory, capture, campaign-clock, operation, or realtime authority. It records:

- the exact Encounter Document and linked-map checkpoint being settled;
- stable participant references and the sheet revisions they point to;
- currently blocking gates;
- a disposition plan for persistent consequences and temporary cleanup;
- reward declarations and destination allocations;
- bounded decisions;
- links to accepted operation receipts;
- terminal completion evidence.

The document may retain frozen scalar before/after evidence so a preview can be explained and stale authority can be detected. Those values are evidence only. The use case that owns HP, Injuries, conditions, inventory, equipment, Experience, captures, objectives, effects, or resources must re-read and validate its own state before any commit.

Whole Encounter Documents, maps, sheets, tokens, Profile-control records, commands, write sets, and mechanics payloads are never embedded.

## Root lifecycle

Every document has `schemaVersion: 1`, a stable settlement identity, compare-and-swap revision, exact encounter reference, authoritative campaign timestamps, and one status:

- `draft` — the source checkpoint is recorded and sections are being derived;
- `blocked` — at least one required gate remains;
- `ready` — the current preview is eligible for explicit completion;
- `committing` — one durable completion command owns the attempt;
- `completed` — an accepted terminal completion receipt is linked;
- `cancelled` — an explicit terminal cancellation receipt is linked.

`completed` pairs only with `completion.state: accepted`; `cancelled` pairs only with `completion.state: cancelled`. Every other status requires an open completion with no operation, receipt, final encounter revision, or completion minute.

All timestamps are campaign minutes. Browser clocks, process uptime, time zones, and wall-clock timestamps have no settlement authority.

## Sections

### Encounter and participants

`encounter` points to one Encounter Document revision and one linked map revision. A participant stores stable encounter/map and sheet references, side and owner relationships, settlement role, and disposition. It does not store a display name or sheet state.

### Unresolved gates

Every row in `unresolvedGates` is blocking and names at least one current authority plus bounded legal resolutions. V1 recognizes pending reactions or resolutions, uncertain commands, private choices, revision conflicts, invalid participants, unallocated rewards, capture destinations, cleanup choices, unsupported authority, GM adjudication, and stale snapshots.

A gate cannot be dismissed through prose. It must be removed by a later revision backed by refresh, exact retry, bounded choice, adjudication, allocation, correction, or exclusion evidence. Accepted decisions and receipts may retain the stable identity of a resolved gate after that gate leaves the current unresolved list; this is audit evidence, not a dangling current-state reference.

### Persistent consequences

Each HP, Injury, condition, capture, inventory, equipment, resource, usage, effect, objective, clock, phase, ownership, or accepted-event consequence names its owner authority, field, participant when applicable, frozen before/after value, and one behavior:

- preserve;
- transform;
- expire;
- reset;
- require a decision.

The snapshot supports bounded integer, boolean, text, text-list, or reference values. Preserve requires byte-equivalent logical values. A decision-required row links a bounded settlement decision. Applied rows link an accepted receipt.

### Reward package and allocations

One reward package contains Experience, money, item, capture, or narrative lines. Every line names a source authority and audience. Serialized item lines represent one whole item and require an exact definition authority. Narrative lines are bounded accepted facts; text never becomes hidden mechanics.

Allocations separately connect a reward line to a revision-bound group, encounter side, participant, Trainer inventory, Pokémon sheet, shared inventory, or Profile destination. Fixed, weighted, individual, and whole methods are representable. The owning reward mechanic remains responsible for totals, compatibility, permissions, capacity, and writes.

A pending reward remains in the document. It cannot disappear merely because completion was attempted.

### Temporary cleanup

Cleanup entries cover combat stages, temporary effects, encounter resources, reservations, zones, ground items, duration effects, encounter items, and initiative. Every row names its current authority, affected participants, exact source identities, disposition, optional decision, and terminal receipt. The settlement document coordinates cleanup; source-owned lifecycle reducers define what expire, reset, transform, or preserve means.

### Decisions

A decision has one or more typed subjects and one bounded option set. An open decision contains no selection or actor evidence. An accepted decision records exactly one offered option, the private GM or Profile principal, and the authoritative campaign minute.

Freeform values are not legal options. Private actor identities stay in the server document and are projected only as role-safe outcomes.

### Receipts and completion

Receipts link settlement subjects and the exact accepted settlement decision to existing accepted operations. They do not duplicate commands, hashes, private read/write sets, or mechanics results. Correction receipts point to one prior receipt.

Terminal completion records one operation, matching completion receipt, final encounter revision, and campaign minute. These fields identify existing idempotency authority; they are not capabilities and never authorize replay by themselves.

## Strictness and limits

The parser:

- detaches untrusted input as strict JSON without getters, prototypes, sparse arrays, symbols, functions, or non-finite numbers;
- rejects unknown or missing fields;
- enforces stable bounded identities and unique local rows;
- rejects dangling participant, reward, decision, receipt, and current local subject references while permitting audited references to resolved gate identities;
- enforces decision, serialized-item, behavior, receipt, completion, and campaign-time invariants;
- deeply freezes accepted documents.

The principal bounds are 1,024 participants, 256 unresolved gates, 4,096 consequences, 1,024 reward lines, 4,096 allocations, 4,096 cleanup entries, 1,024 decisions with at most 64 options each, and 8,192 receipts.

## Privacy

The stored document is server-private. Public and owner projections are built later from explicit audiences:

- `public`;
- `participant-owner`;
- `destination-owner`;
- `gm`.

A projection may resolve safe current labels and accepted summaries from authorized sources. It must omit Profile principal identities, operation identities, authority IDs and revisions, receipt ancestry, private choices, and GM narrative notes. The raw settlement document is never returned verbatim.

## Ordered ownership

P8-071 defines only the document and strict invariants. Later tickets own behavior in dependency order:

- P8-072: eligibility and gates;
- P8-073: consequence snapshots;
- P8-074–P8-078: rewards, allocations, captures, and outcomes;
- P8-079: source-aware cleanup;
- P8-080: atomic commit;
- P8-081: correction, realtime, privacy, and recovery;
- P8-082: Finish Encounter UI and certification.

This separation prevents a schema definition from silently inventing mechanics or granting mutation authority.
