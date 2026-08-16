# Encounter settlement objectives, clocks, phases, and outcomes

P8-078 concludes Encounter Document story state through [`server/domain/encounterSettlement/outcomeSettlement.ts`](../server/domain/encounterSettlement/outcomeSettlement.ts). Its reviewed evidence is [`data/complete-play-loop/encounter-settlement-outcomes.v1.json`](../data/complete-play-loop/encounter-settlement-outcomes.v1.json).

## Exact Encounter Document authority

The planner requires one `authoritative-current` snapshot containing the exact linked Encounter Document and revision, a server-captured write timestamp, complete declarations, a complete campaign-consequence list, and GM authorization bound to that same revision. The document identity, linked map, and revision must match settlement.

The provider accepts active, paused, or already-concluded Encounter Documents but never draft or archived authority. Stale revisions, malformed documents, duplicate declarations, denied authority, and non-monotonic timestamps fail or remain non-applicable before persistence.

## Closed outcome fields

Every current subject receives one explicit declaration:

- an objective becomes **completed** or **failed**;
- a clock becomes **paused** at bounded progress or **completed** exactly at its maximum;
- a phase becomes **completed**, with an optional bounded summary;
- each present public or GM stake becomes **realized**, **avoided**, or **changed**, with a bounded outcome summary.

Omitted subjects remain audience-scoped required decisions. A complete allowed plan sets lifecycle to `completed`. It clears the active phase only because that exact phase was concluded.

Settlement does not re-author labels, visibility, maxima, source stakes, notes, recipes, presentation settings, reserves, waves, or unrelated Encounter Document fields.

## Structured facts and consequence evidence

Each result produces a deterministic fact with closed kind, source subject, audience, exact authority, result code, bounded summary, and a marker distinguishing a closed Encounter Document field from narrative-only evidence.

Objective, clock, and phase changes produce typed settlement consequence snapshots. The provider reuses a matching current consequence when one exists and preserves unrelated HP, injury, condition, equipment, capture, or other snapshot rows. Applied or receipted evidence cannot be rewritten or disappear.

Public source rows produce public facts. GM objectives, GM stakes, and GM campaign consequences stay GM-only.

## Bounded GM campaign consequences

A GM may record up to 128 narrative consequences in closed categories: relationship, location, faction, opportunity, or other. Each has a stable result code and bounded summary, and must state `mechanicalEffect: "none"`.

That rule is deliberate: freeform text is not hidden mechanics. Any money, inventory, sheet, capture, objective, clock, phase, cleanup, or other durable mechanical mutation must come from its separately owned provider and exact write preview.

## Revision-bound application

All closed changes form one next Encounter Document revision. The private plan includes exact current and next revisions, stable-JSON SHA-256 before and after evidence, and the exact next document. Application checks the complete authority hash and every document invariant before exposing one applicable write.

Missing decisions, denied GM authority, narrative mechanics, stale state, or applied-evidence drift makes the plan non-applicable. P8-080 persists the Encounter Document write with rewards, captures, cleanup, settlement history, and completion evidence.

## Privacy

GM authorization and denial, GM stakes source text, GM-only summaries, hashes, timestamps, and internal fact/consequence identities remain private. Later UI may show only audience-authorized labels, result status, progress, bounded summary, and pending state.
