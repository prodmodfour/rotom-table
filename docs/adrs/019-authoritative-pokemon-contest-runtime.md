# ADR 019: Authoritative Pokémon Contest runtime

- Status: Accepted; amended by Deferred Mechanics Closure
- Date: 2026-08-20

## Context

Pokémon Contest facts previously existed only as free-form sheet text and documentary prose. Rotom Table already had ordinary sheet, item, feature-resource, journaled-dice, revision/idempotency, realtime, and atomic-settlement authority. A parallel Contest authority stack would duplicate those guarantees and permit drift.

## Decision

Use reviewed app-owned `contests.json` and structured per-Move Contest identity as the only runtime facts. A running Contest is one schema-versioned SQLite `ContestDocument`; ordinary Trainer/Pokémon sheets remain preparation and reward authority. Every mutation is a bounded revision-checked idempotent command. Production dice are server-generated and journaled. Public, owner, GM, and diagnostic payloads are separately constructed projections. Realtime events are durable role-targeted refresh signals. Settlement writes Contest completion, sheet experience, ribbons, Trainer history, money, items, and sheet realtime events in one transaction.

Standard, Supercontest, Festival, Rotation, Trainer Participant, and Battle are native. Trainer Participant extends compatible base variants through the same Contest document and command authority. Battle joins one Contest document to one real Encounter through typed immutable handoffs, engine-owned local plans, and coordinated transactions; it does not introduce another combat, scoring, dice, realtime, or settlement engine. Created Moves require explicit operation-owned Contest identity binding. Documentary text is never parsed at runtime.

The original P10 decision admitted only Standard, Supercontest, Festival, and Rotation. Plan 11's reviewed source-bound successor chain activated Trainer Participant and Battle after their setup, runtime, projection, recovery, settlement, accessibility, performance, privacy, fixture, and liveplay certificates passed; the frozen P10 acceptance record remains historical evidence.

## Consequences

- Contest appeals cannot consume battle Move frequencies.
- Existing sheet and campaign-attention workflows receive progression consequences.
- Exact retry cannot reroll or duplicate rewards.
- Missing Move identity fails closed visibly.
- Structural projections, not client redaction, enforce trusted-table privacy.
- Canonical and variant fixture drift fails checks before deployment.
- The document snapshot deliberately pins enrolled sheet revisions and providers; later sheet changes apply only to later Contest enrollment unless an explicit correction exists.

Implementation and operator detail lives under [`docs/contests/`](../contests/README.md).