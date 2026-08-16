# Encounter settlement captures

P8-077 settles already accepted captures without running capture again. The server planner is [`server/domain/encounterSettlement/captureSettlement.ts`](../server/domain/encounterSettlement/captureSettlement.ts), and reviewed evidence is [`data/complete-play-loop/encounter-settlement-captures.v1.json`](../data/complete-play-loop/encounter-settlement-captures.v1.json).

## Accepted capture authority

A capture reward must match exactly one schema-v1 accepted record. The record binds the capture operation and accepted-result hash, provenance hash, actor, map-era source authority, capturing Trainer, captured Pokémon, post-capture revisions, original team-or-box result, caught ball, naming requirement, and campaign minute.

Settlement never rerolls capture, consumes another ball, creates a Pokémon sheet, or copies a captured sheet. It loads the exact existing Pokémon and owner Trainer. Current revisions may be newer than the accepted capture revisions, but never older. The Pokémon must occur in exactly one of that Trainer's team or box lists, and the current `caughtBall` value must exactly match accepted evidence. Missing sheets, duplicate custody, changed ball provenance, or a mismatched reward operation fail closed.

## Ownership and Profile validation

A declaration selects one exact Profile, its current hash-bound authority, the accepted owner Trainer, and team or box. The Profile must currently link the owner Trainer. A player capture stays with its accepted actor Profile. A capture performed through explicit GM live-play authority may be assigned to a currently authorised Profile.

Permission comes from the exact current owner Trainer sheet revision. Settlement cannot silently transfer the capture to a different Trainer. Ownership changes require a later explicit workflow.

## Team, box, and naming choices

The active team limit is six. A capture already added by the accepted command may remain where it is or move between team and box. The planner evaluates all declared assignments for each exact Trainer. A team request that would exceed six stays pending and exposes a box-only decision; it is never silently redirected.

There is no finite app-owned box limit. The generic reward boundary therefore uses unbounded Profile capacity while this provider enforces each Trainer's team limit directly.

When accepted capture authority requires naming, settlement needs an explicit **keep** or bounded **set** decision. It does not infer a nickname. Missing assignment, required naming, and team overflow appear as stable required-decision entries and block application.

## Complete reward and sheet preview

Every resolved capture produces exactly one whole Profile allocation and one contributing capture-operation write. A roster move or nickname change adds explicit non-contributing zero-amount leaf evidence. Each changed Trainer or Pokémon sheet advances once, even when multiple captures contribute.

Private sheet plans contain expected and next revisions, stable-JSON SHA-256 before and after evidence, and exact next documents. The caught-ball field is rechecked after planning and cannot be changed by settlement.

## Apply and recovery boundary

Application requires a complete plan and an unchanged hash of records, sheets, Profiles, declarations, and permissions. It then rechecks every sheet revision and hash plus every planned after hash. Any drift rejects the entire applicable set. P8-080 persists the complete capture plans with all other settlement writes; P8-077 performs no partial storage mutation.

Explicitly excluded captures need no assignment. Denied destinations retain private evidence and make no writes. Foreign, applied, receipted, committed, or cancelled capture allocations are never replaced.

## Privacy

Operation IDs, accepted-result and provenance hashes, Profile linking evidence, sheet documents and hashes, and source-write IDs remain private. Authorised UI may later show safe Pokémon and Trainer labels, team or box, team occupancy, naming-needed status, and the caught-ball label. It must not expose operation or Profile evidence.
