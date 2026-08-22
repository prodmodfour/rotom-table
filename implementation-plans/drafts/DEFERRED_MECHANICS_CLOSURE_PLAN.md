# Deferred Mechanics Closure — Draft Scope

`DRAFT_STATUS: REVIEW_REQUIRED`

`AUTHORITATIVE_LEDGER: NO`

`PROPOSED_ORDER: 11`

`DEPENDS_ON: implementation-plans/done/POKEMON_CONTESTS_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_TARGET: 1.0 CORE-COMPLETE LIVEPLAY`

## Registration boundary

This document is the Plan 10 closure draft requested by P10-100. It is registered only in the **Prospective plans toward 1.0** table in `implementation-plans/plan-order.md`. It is not an executable ticket ledger, has no `PLAN_STATUS` or `CURRENT_TICKET`, and creates no autonomous implementation obligation until its scope is reviewed, converted into numbered tickets with acceptance evidence, and registered in the authoritative implementation-plan table.

## Proposed goal

Drive every known mechanics row that prior plans intentionally left deferred, visible-with-reason, or absent from canonical authority to a final reviewed state so trusted-table liveplay has no known core-rule mechanics gap before the GM Campaign Toolkit begins.

The closure must preserve all authority, privacy, deterministic-evidence, and liveplay guarantees established by Plans 1–10. Documentary sources remain provenance only; runtime semantics must come from reviewed app-owned `data/reference/*.json` data.

## Recorded scope commitment

The Plan 11 ledger should own the union recorded in the 1.0 release definition:

1. six deferred ranged-weapon profiles;
2. seven absent supplemental Move definitions;
3. deferred item actions still visible-with-reason or otherwise non-final for core play;
4. Battle Contest and Trainer Participant Contest variants;
5. a generic server-authoritative liveplay Skill Check surface if the opening audit confirms that no existing surface closes the gap;
6. a repository-wide proof that no known mechanics row remains deferred, blocked, prose-inferred, or silently absent.

## Proposed non-goals

- Supplement content packs, playtest packets, and setting-specific books.
- Public authentication, multi-tenancy, federation, or public-service hardening.
- The encounter-table and NPC-generation work reserved for the prospective GM Campaign Toolkit.
- Release versioning, campaign upgrade guarantees at the release boundary, release notes, tags, and fan-content review reserved for prospective 1.0 Release Readiness.
- Guessing missing identities or mechanics from websites, wikis, parser output, PDFs, or free-form prose.

## Proposed completion rules

- Every audited row ends in a mechanically complete final state; Plan 11 should not introduce a new deferred or visible-with-reason state.
- Missing or ambiguous canonical data fails closed and is repaired only through a reviewed, source-hash-bound app-owned migration.
- The server owns randomness, legality, resource consumption, revisions, idempotency, and accepted results.
- Existing battle, Contest, item, sheet, realtime, settlement, and campaign-clock authorities are extended rather than forked.
- Role projections remain structurally distinct, and no client redaction is treated as authority.
- Every user-visible action has a complete authoritative commit path, recovery behavior, and focused acceptance evidence.
- Full-suite, production build, desktop/mobile liveplay, migration, backup/restore, and quality-gate acceptance are closure requirements.

## Proposed workstreams

### A. Opening closure inventory

- Reconcile every prior plan's deferred, assisted, visible-with-reason, reference-only, and explicit non-goal rows.
- Separate genuine core gaps from supplemental/post-1.0 content and stale documentation.
- Produce one versioned inventory with stable IDs, owning app paths, canonical-data status, privacy implications, and proposed acceptance tests.
- Confirm the exact six weapon profiles, seven Move definitions, and deferred item-action set before ticket numbering.
- Decide from executable evidence whether a generic Skill Check runtime is absent or already closed by existing authority.

### B. Reviewed canonical-data remediation

- Add or repair only app-owned canonical reference rows through source-hash-bound reviewed migrations.
- Preserve frozen historical fingerprints through explicit successor chains or authority-specific mechanical projections.
- Fail closed for any unresolved identity; do not use runtime prose parsing.
- Add drift gates covering every repaired row and downstream legacy consumer.

### C. Deferred ranged-weapon profiles

- Define stable weapon/profile identities, ranges, damage, keywords, ammunition/resource semantics, and equipment custody from reviewed authority.
- Integrate declarations and resolution with existing encounter offers, map targeting, reactions, accepted results, and history.
- Certify ownership, targeting, resource spend, exact retry, correction, realtime, accessibility, and performance across all six profiles.

### D. Supplemental Move definitions

- Establish reviewed canonical identities for the seven absent definitions without silently changing existing Move rows.
- Route each through the existing Move Automation ruleset, manifest, offer, execution, recovery, and completion gates.
- Preserve battle and Contest projections independently when a Move participates in both modes.
- Re-run complete Move coverage and all frozen-successor checks.

### E. Deferred item actions

- Inventory every remaining core item action and classify its final native, guided, passive, or truly non-mechanical result.
- Complete custody, target, timing, duration, resource, receipt, history, attention, and rollback semantics using the existing item runtime.
- Rebuild item cohorts and downstream evidence only after intentional review.
- Prove zero blocked or visible-with-reason core item action remains.

### F. Trainer Participant Contests

- Extend the existing Contest document and role model to trainer performers without creating parallel sheet or dice authority.
- Define reviewed eligibility, preparation, introduction, appeal, resource, effect, projection, and settlement semantics.
- Preserve privacy and deterministic replay across GM, competing owner, and spectator clients.
- Certify all supported scales and interactions with ordinary Contest variants where canonically valid.

### G. Battle Contests

- Define the reviewed boundary between the Contest and encounter engines before implementation.
- Reuse encounter combat authority and Contest scoring/settlement authority through explicit handoff contracts rather than cross-writing documents.
- Specify initiative, targeting, Move use, damage/consequence, Contest scoring, interruption, restart, correction, and completion semantics.
- Certify no double spending, divergent randomness, private leak, or partial settlement across the two engines.

### H. Generic liveplay Skill Checks, if required

- Confirm the gap through the opening inventory before activating this workstream.
- If required, define a small server-authoritative check document/operation that reuses canonical Skills, modifiers, dice journals, role projections, accepted-result presentation, exact retry, and campaign history.
- Keep it generic enough for core campaign adjudication without becoming a narrative-generation or automation-scripting subsystem.
- If existing authority already closes the gap, record a reviewed no-new-runtime decision with executable evidence.

### I. Integrated zero-deferred closure

- Run cross-subsystem journeys spanning equipment, Moves, items, skill checks, encounters, both added Contest variants, settlement, and campaign continuation.
- Certify fresh database, historical upgrade, backup/restore, restart, reconnect, stale conflicts, exact retry, rollback, privacy, accessibility, and performance.
- Publish contributor/operator guidance and a machine-readable final acceptance record.
- Require zero known core deferred mechanics before Plan 12 may activate.

## Questions requiring review before activation

1. Which documentary source set and errata fingerprints authorize the six weapon profiles and seven Move definitions?
2. Are any currently deferred item actions supplemental rather than PTU 1.05 core?
3. Should Trainer Participant and Battle Contest support all three/four/five scales at first activation, or does reviewed canon constrain their matrices?
4. What is the exact atomic handoff boundary between encounter and Contest documents for Battle Contests?
5. Does the current app already contain a sufficiently generic server-authoritative Skill Check operation?
6. What ticket count best preserves small, independently verifiable changes without duplicating prior-plan gates?

## Activation checklist

Before this draft can become an authoritative Plan 11 ledger:

- review and freeze the opening inventory scope;
- resolve the six-weapon, seven-Move, and item-action identities;
- choose explicit source fingerprints and migration policy;
- settle the Battle Contest cross-engine architecture;
- decide the generic Skill Check question;
- write numbered tickets, phase exit gates, completion rubric, and first playable slice;
- register the resulting ledger in the authoritative plan table with `PLAN_STATUS`, `CURRENT_TICKET`, dependency, counts, and blocker state;
- synchronize `AGENTS.md` in the same change.
