# Encounter settlement temporary cleanup

P8-079 plans encounter-end cleanup through [`server/domain/encounterSettlement/temporaryCleanup.ts`](../server/domain/encounterSettlement/temporaryCleanup.ts). Its reviewed evidence is [`data/complete-play-loop/encounter-settlement-temporary-cleanup.v1.json`](../data/complete-play-loop/encounter-settlement-temporary-cleanup.v1.json).

## Complete current authority

Cleanup requires one `authoritative-current` read containing:

- the exact linked map and revision;
- an exact backing-sheet document and revision for every placement;
- the complete set of active reservation operation identities;
- the complete set of typed cleanup transformations;
- GM authorization pinned to that map revision; and
- one server-captured monotonic write timestamp.

Every effect, zone, map-ground item, backing sheet, encounter-resource directory, present initiative tracker, active reservation, and pending encounter-item decision must occur in exactly one settlement cleanup entry. Missing, duplicate, foreign, ambiguous, or stale source identity fails closed. Cleanup never searches by a display name, tag, summary, or inferred owner.

## Reused encounter lifecycle

The planner emits the existing authoritative `encounter-end` lifecycle event. It therefore reuses the same reducers as live play instead of introducing a settlement-only mechanics lane:

- the item lifecycle handler resets Combat Stages and Accuracy stages through typed sheet operations;
- turn, round, and encounter effects expire through the effect-duration reducer;
- encounter turn-resource and structured-history windows reset through their existing reducers; and
- lifecycle-triggered sheet work remains exact-revision and source-bound.

A settlement cleanup action then composes map-owned state around that result. Initiative reset clears encounter-scoped placement scores and writes the normalized tracker state `{ activeId: null, round: 1 }`; this prevents storage normalization from resurrecting an ended order. Zone durations use the same boundary distinction as effects. Ground items remain map-owned unless their exact cleanup entry says expire or provides a reviewed transform.

## State deliberately preserved

Finishing an encounter is not the same as ending its Scene or advancing campaign time. Cleanup retains, unless a separate exact provider owns a change:

- current HP, injuries, and persistent conditions;
- inventory, equipment, money, experience, and durable advancement;
- active Scene identity, Scene move usage, and Scene temporary HP;
- Scene effects, Scene form changes, and Scene zones;
- campaign-time, explicitly dismissed, until-triggered, and permanent effects; and
- unrelated sheet and map state.

That distinction prevents encounter settlement from accidentally becoming a rest, Scene transition, inventory correction, or broad character reset.

## Reservations and pending work

Inventory reservation is derived from a pending item operation, not an independent mutable row. An active reservation therefore remains a settlement blocker. Cleanup does **not** abandon the operation, release the item, or infer that an unresolved choice may be discarded.

The same rule applies to pending encounter-item positioning and other unresolved mechanics. They must resolve or be explicitly abandoned through their owning workflow before cleanup can expose writes.

## Typed transforms

A transform may replace one exact effect, zone, or ground item. It must:

1. retain the stable source identity;
2. pass that source type's strict parser;
3. name one exact provider authority and revision; and
4. match the authority pinned by an accepted cleanup decision when a choice selected it.

Generic JSON patches, cross-kind replacement, identity changes, and mechanics inferred from freeform text are rejected.

## Explainable preview

The private plan emits one deterministic row per source with:

- cleanup entry and closed cleanup kind;
- exact source identity and source kind;
- `reset`, `expire`, `preserve`, `transform`, `exclude`, or `pending` action;
- a closed result code; and
- whether current authority changes.

Open choices, denied authorization, active reservations, and pending encounter items remain explicit blockers. A blocked plan returns no applicable map or sheet writes.

Future role projections may expose only audience-safe labels, action, changed state, and blocker summaries. Internal identities, revisions, hashes, operation IDs, provider evidence, and private map or sheet content stay server-side.

## Revision-bound application and replay

All map changes compose into at most one next map revision. Each changed sheet receives one next revision. The plan retains stable-JSON SHA-256 evidence for exact previous and next documents.

Application rechecks the complete authority hash, map and sheet revisions, before and after hashes, and monotonic next revisions. The same settlement plus the same complete authority produces the same event identity, previews, and writes. Stale plans must be rebuilt from a fresh complete read; they are never rebased by labels.

P8-080 persists these writes with rewards, captures, outcomes, settlement history, and completion in one transaction. Committing, completed, cancelled, applied, or receipted cleanup cannot be planned as new work.
