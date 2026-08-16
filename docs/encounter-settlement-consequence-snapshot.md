# Encounter settlement consequence snapshot

P8-073 builds the private persistent-versus-temporary snapshot used by encounter settlement review. The source policy is [`server/domain/encounterSettlement/consequenceSnapshot.ts`](../server/domain/encounterSettlement/consequenceSnapshot.ts), and its reviewed contract is [`data/complete-play-loop/encounter-settlement-consequence-snapshot.v1.json`](../data/complete-play-loop/encounter-settlement-consequence-snapshot.v1.json).

## Complete source coverage

A snapshot is accepted only from one `authoritative-current` read. It contains exactly one coverage row for every consequence and cleanup domain. Each row is explicitly `complete` or `not-applicable` and names at least one exact source authority. A fact:

- cannot appear under `not-applicable` coverage;
- must use an exact authority listed by its domain coverage;
- has one globally unique stable source-fact identity;
- cannot duplicate a participant, consequence kind, and field;
- cannot refer to a participant outside the settlement.

Every current participant requires HP, Injury, condition, and equipment evidence even when the corresponding value is empty or unchanged. This prevents a missing sheet read from looking like “nothing happened.” Other domains may legitimately contain zero facts, but their owning provider must still record complete or not-applicable coverage.

The builder never derives mechanics from labels, names, prose, tags, client snapshots, or browser time.

## Persistent consequences

Persistent rows cover:

- HP and Injuries;
- conditions;
- captures and ownership;
- inventory and equipment;
- durable resources and usage;
- persistent effects;
- objectives, clocks, and phases;
- accepted encounter events.

Each row records one exact authority, stable field identity, optional participant, bounded scalar before/after snapshot, and one behavior. Persistent rows may preserve, transform, or require a bounded decision according to their closed domain policy. Expiration and reset belong to temporary cleanup instead.

HP is preserve-only at this boundary: encounter damage and healing must already be accepted through HP authority, not invented during settlement. Accepted-event evidence is also preserve-only. A settlement records that an accepted event remains part of the encounter history; it cannot rewrite the event.

Snapshots are preview and stale-detection evidence. They are not writable copies of sheets, captures, inventories, objectives, clocks, phases, effects, resources, or event journals.

## Temporary cleanup

Temporary rows cover combat stages, temporary effects, encounter resources, reservations, zones, ground items, duration effects, encounter items, and initiative. They name exact source identities, affected participants, source authority, and one closed behavior:

- combat stages, encounter resources, and initiative reset;
- reservations expire;
- temporary effects and encounter items expire, transform, or require a decision;
- zones, ground items, and duration effects may also be explicitly preserved when their owning contract permits it.

These rows explain the intended cleanup. They do not execute it. P8-079 delegates each row to its source-owned lifecycle reducer and revalidates the same authority.

## Bounded decisions

`require-decision` must carry an audience-specific option set, and no other behavior may carry one. Every option:

- has a stable offered identity and bounded value identity;
- uses only accept, exclude, or transform;
- names the exact current fact authority.

The builder creates deterministic decision and entry identities from the settlement, scope, and source-fact identity. An accepted decision is retained only while its subject, audience, ordered options, and authority remain byte-equivalent. Refresh cannot rewrite an accepted choice. Freeform values are not options.

## Refresh, audit, and terminal boundaries

A current uncommitted snapshot can refresh proposed or ready entries. It cannot:

- rewrite an applied entry or linked receipt;
- make applied source evidence disappear;
- make an accepted snapshot decision disappear;
- replace a foreign consequence or cleanup row that was not produced by this versioned builder;
- rebuild after settlement enters `committing`, `completed`, or `cancelled`.

Rows and decisions are emitted in deterministic identity order and the resulting settlement document is run through the strict version-1 parser.

## Privacy and ownership

The snapshot is server-private. Source-fact IDs, authority IDs and revisions, source cleanup identities, option IDs, Profile principals, operation IDs, and receipt IDs are never public projection data. Later projections resolve only safe labels and behavior summaries from currently authorized sources.

The builder owns coverage, classification, bounded preview evidence, and decision offers. Existing source use cases continue to own every mechanic. It does not advance settlement revision, persist data, apply cleanup, mutate state, or publish realtime events.
