# Deferred Mechanics Closure Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: P11-002`

`BLOCKED_BY: NONE`

`DEPENDS_ON: implementation-plans/done/POKEMON_CONTESTS_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

`PRODUCT_PHASE: ALPHA`

## Goal

Drive every known mechanics row that Plans 1–10 intentionally left deferred, visible-with-reason, reference-only-with-mechanics, or absent from canonical authority to a final reviewed state, so trusted-table liveplay has no known core-rule mechanics gap before the GM Campaign Toolkit begins.

This is a closure plan, not a new-subsystem plan. Every workstream extends an existing authority — the encounter engine, the Move Automation gates, the item runtime, the Contest engine, sheet and dice authority, settlement, and the campaign clock — and the plan may not introduce a new deferred or visible-with-reason state of its own.

## Product outcome

The completed product supports these journeys that are impossible or visibly unavailable today:

1. A trainer equips any of the six ranged weapons and makes ranged weapon attacks on the live map with authoritative range, targeting, accuracy, damage, and history.
2. Wielders at the canonical Combat ranks use all twelve weapon Moves natively, including the seven currently absent definitions, through the ordinary Move gates.
3. Shields ready, nets throw and pull, the Glue Cannon fires, the Shock Collar activates, the Snag Machine converts, and the fishing rods fish — every core item action ends native, guided, or passive with a complete commit path and receipts.
4. The GM requests a generic server-authoritative Skill Check from any trainer or Pokémon — single or group — with journaled dice, role-safe projections, accepted results, and campaign history.
5. Trainers enroll as performers in Trainer Participant Contests and appeal alongside their Pokémon under the canonical method policies.
6. Two trainers run a Battle Contest: a real encounter and a real Contest scoring surface joined by one reviewed blend contract, with per-Pokémon voltage, appeal tallies, and atomic settlement.
7. A repository-wide machine-readable proof certifies that zero known core mechanics rows remain deferred, blocked, prose-inferred, or silently absent.

## Current baseline

Verified against the repository at activation:

- `data/complete-play-loop/equipment-grants.v1.json` (P8-047 registry) records **6 `definition-missing` ranged weapon profiles** (Weighted Rope, Slingshot, Throwing Hammers, Hunting Bow, Super Lucky Throwing Stars, Twin-Needled Bow), **7 `definition-missing` weapon Moves** (`Bash!`, `Pierce!`, `Gouge`, `Titanic Slam`, `Bullseye`, `Deadly Strike`, `Triple Threat`), and **11 `deferred` item actions** (Old/Good/Super Rod fish, Glue Cannon attack, Hand Net attack, Weighted Nets throw and pull, Light/Heavy Shield ready, Snag Machine convert, Shock Collar activate) whose `deferredTicket` pointers cite completed Plan 8 tickets.
- `scripts/generate_complete_play_loop_equipment_grants.py` hard-codes `executionStatus: definition-missing` for non-melee weapon classes; the ranged class chart was never encoded.
- `shared/capabilityAutomation/weaponMoves.ts` holds five reviewed native weapon-Move definitions (Backswing, Cheap Shot, Double Swipe, Wounding Strike, Bleed!) and documents that supplemental weapon Moves intentionally live outside the frozen `data/reference/moves.json` catalog.
- `data/reference/items.json` carries canonical identity, class, granted-Move names, and substantive effect prose for all 18 affected items, sourced from `09-gear-and-items.md`.
- `data/reference/contests.json` carries `reference-only` variant rows for `trainer-participant` and `battle` with explicit safe reasons, bound to fingerprinted documentary sources including `books/markdown/core/08-pokemon-contests.md`.
- `data/complete-play-loop/item-catalog-cohorts.v1.json` records the affected items' cohorts as final `passive` with zero unresolved requirements, contradicting the grant-level deferred states; the closure inventory must reconcile which surface the zero-deferred proof reads.
- No generic server-authoritative Skill Check surface exists; only item- and move-embedded check machinery (the `skill-check` healing amount kind, opposed-check move windows, breeding and exploration adjudications).
- Plans 1–10 are `DONE` and archived with frozen acceptance records, including Plan 10's 777/761/16 contest Move-coverage counts.

## In scope

- The closure inventory: one versioned reconciliation of every prior-plan deferred, visible-with-reason, reference-only, and explicit non-goal row into final-state decisions.
- Reviewed source-hash-bound remediation of the equipment-grants generator, the weapon-Move registry, and the Contest variant rows.
- Native runtime for the six ranged weapon profiles and seven weapon Moves through existing encounter, targeting, and Move authority.
- Final native, guided, or passive completion for all eleven deferred item actions, including their conditions, durations, custody, and receipts.
- A generic server-authoritative liveplay Skill Check document and operation family.
- Trainer Participant Contests and Battle Contests as native Contest variants on the existing Contest and encounter engines.
- Registry rebuilds, drift gates, migration/upgrade certification, documentation, and the zero-deferred acceptance record.

## Explicit non-goals

- Supplement content packs, playtest packets, and setting-specific books; the canonical scope remains PTU 1.05 core plus published errata as represented in app-owned reference data.
- Wild-encounter generation, encounter tables, NPC trainer generation, and session-preparation tooling (Plan 12); fishing hands its hook outcome to GM adjudication in this plan, and Plan 12 may later automate what is hooked.
- Release versioning, campaign upgrade guarantees at the release boundary, release notes, tags, repository presentation, and fan-content review (Plan 13).
- Public authentication, multi-tenancy, federation, or public-service hardening.
- Guessing missing identities or mechanics from websites, wikis, parser output, PDFs, or free-form prose; documentary chapters and errata remain provenance for reviewed migrations only.
- A second dice, realtime, automation, settlement, or sheet engine beside the existing shared authority.
- Judge, audience, or narrative simulation beyond the canonical Contest mechanics; automation scripting or macro subsystems around Skill Checks.

## Completion states for audited rows

Every audited row must end in exactly one reviewed state, matching the Plan 8 and Plan 10 rubrics:

- **Native** — Rotom Table validates and resolves the complete mechanical effect authoritatively.
- **Guided** — Rotom Table owns eligibility, timing, costs, choices, receipts, and commit, while a bounded GM decision supplies the rule's interpretive outcome.
- **Passive** — the row contributes automatically while legally held, equipped, worn, or active.
- **Reference-only** — the row has no supported mechanical action and the reason is explicit and canonical, not a deferral.
- **Not applicable** — the row is documentary, category-only, or otherwise not actionable.
- **Blocked** — required canonical data or infrastructure is missing. This is a temporary work state and is forbidden at final acceptance.

`definition-missing`, `deferred`, and deferral-flavored `reference-only` states are the debt this plan retires; none may survive final acceptance, and no ticket may resolve a row by downgrading a concrete mechanic into reference-only prose.

## Non-negotiable product rules

1. **Closure means final states.** Every audited row ends mechanically complete; this plan introduces no new deferred, blocked, or visible-with-reason state anywhere.
2. **Canonical identity fails closed.** Missing or ambiguous canonical data is repaired only through reviewed, source-hash-bound app-owned migrations or reviewed hash-bound registry extensions; no runtime prose parsing.
3. **Frozen history stays frozen.** Plan 1–10 acceptance records, fingerprints, and coverage counts advance only through explicit successor chains, never in-place edits.
4. **The server owns randomness, legality, resource consumption, revisions, idempotency, and accepted results.** The browser never rolls, scores, or spends.
5. **Existing authorities are extended, never forked.** Weapons use the encounter and equipment authority, weapon Moves use the Move gates, item actions use the item runtime, Contest variants use the Contest engine, and Battle Contests join the Contest and encounter engines through one reviewed contract without cross-writing documents.
6. **Role projections remain structurally distinct.** GM, owner, actor, and spectator surfaces are separate projections; no client redaction is authority.
7. **Every user-visible action has a complete authoritative commit path**, recovery behavior, exact-retry semantics, and focused acceptance evidence.
8. **No double spending across engines.** Battle Contests must prove single-spend frequencies, dice, and resources, convergent randomness, and atomic settlement across both documents.
9. **Weapon Moves stay outside the frozen Pokémon Move catalog** and fail closed in Contest appeal legality until canonical contest identity exists for them.
10. **Full-suite, production build, desktop/mobile liveplay, migration, backup/restore, and quality-gate acceptance are closure requirements**, not optional extras.

## Target architecture

```text
app-owned canonical data
  (items.json identities + effect rows, contests.json successor variant rows,
   fingerprinted 09-gear-and-items.md / 08-pokemon-contests.md / errata provenance)
  -> reviewed hash-bound registries
     (equipment grants generator + weapon-move registry + item specs)
  -> existing encounter authority: declarations, targeting, reactions,
     accepted results, resources, history
  -> existing item runtime: offers, custody, durations, receipts, attention
  -> new SkillCheckDocument: request -> journaled roll -> accepted result
  -> existing ContestDocument + variant semantics
     -> Trainer Participant: paired performers on one contest authority
     -> Battle Contest: ContestDocument <-> EncounterDocument blend contract
        (typed handoff facts, single-spend proofs, atomic settlement)
  -> registry rebuilds + drift gates + zero-deferred closure inventory
```

## First playable vertical slice

> A trainer equips a Hunting Bow on their ordinary sheet, joins a live encounter, and makes a long-range weapon attack against a target on the map with server-authoritative range legality, accuracy, damage, and history. At Adept Combat rank the same trainer uses `Pierce!` natively through the ordinary Move offer, execution, and accepted-result flow, and the previous safe-unavailable reason is gone from the Action Dock.

This slice must be complete before widening to the remaining five profiles, the other six weapon Moves, and the item-action, Skill Check, and Contest variant phases.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered unfinished ticket; only one ticket is `IN_PROGRESS` unless the decision log explicitly permits bounded parallel work.
- Update this ledger, `implementation-plans/plan-order.md`, and `AGENTS.md` together whenever plan status, current ticket, dependency, blocker, or ticket count changes.
- Mark a ticket `DONE` only after focused automated tests, required fixtures, role/privacy checks, recovery behavior, and user-facing acceptance pass.
- Follow the repository's bounded-worker validation discipline and reserve the full suite, production build, and `scripts/quality-gate.sh` for meaningful integration milestones and final closure.
- New mechanics must be traceable to app-owned canonical data, stable identity, evidence, and source fingerprints; documentary chapters and errata are provenance for reviewed migrations and registry extensions only.
- A surface is incomplete if the user can select an option that the server cannot authoritatively validate, roll, and commit.
- `PLAN_STATUS: DONE` is permitted only after P11-092, all 92 tickets, a zero-deferred closure inventory, and all golden journeys are complete.

## Progress snapshot

- Plan tickets: **1 DONE / 92 total**
- Current ticket: **P11-002**
- Blocking dependency: **none; Plans 1–10 are complete and archived**
- Closure targets at activation: **6 ranged weapon profiles, 7 weapon Moves, 11 item actions, 2 Contest variants, 1 Skill Check surface, plus the reconciled inventory**
- Known contradictions at activation: **grant-level deferred states vs. cohort-level `passive` finality; stale `deferredTicket` pointers to completed Plan 8 tickets; one stale deferred-language line in `docs/live-play-authority.md`**

## Tickets

### Phase 1 — Closure inventory, reviewed authority, and fixtures

- [x] **P11-001 — Build the versioned closure inventory** — `DONE`
  - Reconcile every prior plan's deferred, assisted, visible-with-reason, reference-only, and explicit non-goal rows into one versioned inventory with stable IDs, owning app paths, canonical-data status, privacy implications, current-vs-target states, and proposed acceptance evidence, separating genuine core gaps from supplemental or post-1.0 content and stale documentation.
  - Resolve the grant-level versus cohort-level finality contradiction by declaring which registry surface the final zero-deferred proof reads, and record the decision in the inventory artifact under `data/deferred-closure/`.
  - Evidence: `data/deferred-closure/closure-inventory.v1.json` records the activation baseline — 29 rows (27 mechanics: 6 weapon profiles, 7 weapon Moves with registry grant bindings, 11 item actions with stale-pointer facts, 2 Contest variants, 1 runtime surface; plus 2 hygiene rows) and 8 reviewed non-gaps with classifications. The finality decision names the grants registry, `contests.json`, and the inventory itself as the zero-deferred read surfaces and demotes cohort `implementationState` to derived presentation reconciled at P11-042 and proved at P11-089. Frozen-source hashes bind `items.json` and `moves.json`; mutable surfaces record observed hashes and expected mutations. `tests/data/deferredClosureInventory.test.ts` (8 tests) validates structure, ledger-ticket references, frozen sources, canonical identity bindings, monotone closure progress in the grants registry and contest variants, the finality decision, and non-gap/registry completeness; all pass under bounded workers.
- [ ] **P11-002 — Re-home stale deferred pointers and stale documentation** — `TODO`
  - Repoint all eleven `deferredTicket` values in the equipment-grants generator and registry from completed Plan 8 tickets to their owning Plan 11 tickets and regenerate the registry with drift checks.
  - Verify or retire stale deferred-state documentation, including the `docs/live-play-authority.md` claim that concrete move/field trigger registrations remain deferred to their owning tickets.
- [ ] **P11-003 — Record the reviewed source-fingerprint and successor policy** — `TODO`
  - Record the exact documentary fingerprints (including `books/markdown/core/09-gear-and-items.md`, `08-pokemon-contests.md`, and the errata files) that authorize the weapon, Move, item-action, and Contest-variant remediations, plus the successor-chain policy for every frozen Plan 1–10 acceptance record these changes touch.
  - Fail closed on any identity the fingerprinted sources do not define; file explicit data defects instead of interpreting prose at runtime.
- [ ] **P11-004 — Extend the equipment-grants generator with ranged weapon classes** — `TODO`
  - Encode the reviewed short-range and long-range class semantics — range values, damage-base contribution, accuracy behavior, hands, wielder policy, and ammunition/charge policy — in the reviewed generator, bound to the recorded fingerprints, mirroring how melee classes carry `damageBaseBonus` and `accuracyCheckPenalty`.
  - Regenerate `data/complete-play-loop/equipment-grants.v1.json` so all six profiles become `native` grant rows, with generator drift checks and no change to unrelated grants.
- [ ] **P11-005 — Extend the reviewed weapon-Move registry with the seven definitions** — `TODO`
  - Add `Bash!`, `Pierce!`, `Gouge`, `Titanic Slam`, `Bullseye`, `Deadly Strike`, and `Triple Threat` to the reviewed weapon-Move registry with stats from the fingerprinted weapon chapter, following the documented precedent that supplemental weapon Moves live outside the frozen `data/reference/moves.json` catalog.
  - Leave Plan 10's 777/761/16 contest-coverage records untouched, and certify that weapon Moves without canonical contest identity fail closed in Contest appeal legality.
- [ ] **P11-006 — Upgrade the Contest variant rows through a successor migration** — `TODO`
  - Upgrade the `trainer-participant` and `battle` rows in `data/reference/contests.json` from `reference-only` to structured semantics through a reviewed source-hash-bound successor migration: method policies, shared dice-pool policy, and voltage policies for Trainer Participant; trainer count, per-trainer Pokémon counts (3–6), round budget (twice the per-trainer count), adjacency, voltage, KO/recall, replacement, and end-condition rules for Battle Contests.
  - Preserve the existing variant rows and fingerprints through the successor chain and fail closed where the fingerprinted chapter and errata do not define a value.
- [ ] **P11-007 — Define the generic Skill Check contract** — `TODO`
  - Record the reviewed no-existing-surface evidence, then define the `SkillCheckDocument` and operation contract: requester and subject identities, canonical sheet skill identities, DC and opposed policies, modifier resolution, journaled dice, accepted results, revisions, idempotency, and privacy boundaries.
  - Keep the contract generic enough for core campaign adjudication without becoming a narrative-generation or automation-scripting subsystem.
- [ ] **P11-008 — Define the Plan 11 completion rubric and evidence registry** — `TODO`
  - Bind every closure-inventory row to its target final state, owning ticket, and machine-checkable acceptance evidence in a versioned rubric under `data/deferred-closure/`.
  - Forbid new deferred states structurally: the rubric checker must fail on any `definition-missing`, `deferred`, or deferral-flavored reason code in the audited registries.
- [ ] **P11-009 — Create deterministic acceptance fixtures for weapons, Moves, and item actions** — `TODO`
  - Add seeded fixtures binding expected range legality, accuracy, damage, effect, duration, custody, and receipt outcomes for all six profiles, seven Moves, and eleven item actions to canonical source fingerprints.
  - Include trainer and Pokémon wielders, rank gates, and at least one illegal declaration per surface with its stable validation code.
- [ ] **P11-010 — Create failure, concurrency, and recovery fixtures** — `TODO`
  - Add deterministic fixtures for stale revisions, duplicate declarations, reconnects, restarts mid-action, interrupted settlements, and dual-engine conflicts for every new surface, each defining public, owner, and GM projections plus retry and rollback expectations.
  - Bind the Battle Contest fixtures to both documents so no partial cross-engine state can pass acceptance.

### Phase 2 — Ranged weapon profiles

- [ ] **P11-011 — Extend weapon selector and sheet authority to ranged classes** — `TODO`
  - Extend the opaque weapon-selector presentation identities, exact sheet revalidation, and equipment custody checks to short-range and long-range profiles for trainer and eligible Pokémon wielders.
  - Preserve the existing rule that descriptive held or slot text grants nothing.
- [ ] **P11-012 — Implement ranged range and targeting legality** — `TODO`
  - Enforce canonical range values, line-of-sight, and target legality for ranged weapon attacks through the existing map targeting authority, with stable validation codes for out-of-range and blocked declarations.
  - Cover both weapon classes and reuse existing cover/visibility semantics without forking them.
- [ ] **P11-013 — Implement ammunition, charge, and recovery semantics** — `TODO`
  - Implement the reviewed ammunition/charge policy per profile — including thrown-weapon recovery where canonical — through existing inventory custody and consumption authority with receipts and exact retry.
  - Fail closed on any profile whose fingerprinted sources define no consumable semantics rather than inventing them.
- [ ] **P11-014 — Route ranged weapon attacks through the attack executor** — `TODO`
  - Resolve ranged weapon attacks through the existing weapon-attack execution path: server-rolled accuracy against evasion, damage-base resolution with the class contribution, crit handling, injuries, and accepted results with history.
  - Certify no divergence from melee weapon attack semantics except the reviewed class differences.
- [ ] **P11-015 — Complete the Weighted Rope profile** — `TODO`
  - Deliver the native short-range profile end to end: offers, declaration, targeting, resolution, receipts, and the retirement of its safe-unavailable reason.
  - Add focused coverage for its reviewed class semantics and custody.
- [ ] **P11-016 — Complete the Slingshot profile** — `TODO`
  - Deliver the native long-range profile end to end with its reviewed ammunition policy.
  - Add focused coverage including out-of-range and no-ammunition validation codes.
- [ ] **P11-017 — Complete the Throwing Hammers profile** — `TODO`
  - Deliver the native short-range profile end to end, including thrown recovery semantics where canonical.
  - Wire the Adept-rank `Bash!` grant eligibility so the Phase 3 Move lands on live custody facts.
- [ ] **P11-018 — Complete the Hunting Bow profile** — `TODO`
  - Deliver the native long-range profile end to end and wire Adept-rank `Pierce!` grant eligibility.
  - Complete the first playable vertical slice in desktop and mobile liveplay and record its evidence.
- [ ] **P11-019 — Complete the Super Lucky Throwing Stars profile** — `TODO`
  - Deliver the native short-range profile end to end and wire `Bullseye` and `Deadly Strike` grant eligibility at their canonical ranks.
  - Include any reviewed luck semantics the fingerprinted sources define, failing closed otherwise.
- [ ] **P11-020 — Complete the Twin-Needled Bow profile** — `TODO`
  - Deliver the native long-range profile end to end and wire `Triple Threat` grant eligibility beside the already-native `Double Swipe`.
  - Certify mixed native-plus-new grant presentation on one item.
- [ ] **P11-021 — Complete ranged weapon presentation and accessibility** — `TODO`
  - Retire all six deferred presentation reasons from the Action Dock, sheet, and inventory surfaces; project range, ammunition, and readiness facts role-safely.
  - Pass keyboard, touch, screen-reader, zoom, and reduced-motion checks on the new surfaces.
- [ ] **P11-022 — Certify the ranged weapon cohort** — `TODO`
  - Certify ownership, custody, source loss, suppression, exact retry, correction, realtime convergence, and performance across all six profiles with the Phase 1 fixtures.
  - Regenerate the grants registry and prove zero `definition-missing` weapon-profile rows remain.

### Phase 3 — Weapon Move execution

- [ ] **P11-023 — Implement `Bash!` natively** — `TODO`
  - Route the Move through the existing offer, legality, execution, accepted-result, and history gates from Throwing Hammers custody at Adept rank.
  - Add focused execution and validation coverage bound to the Phase 1 fixtures.
- [ ] **P11-024 — Implement `Pierce!` natively** — `TODO`
  - Deliver the Hunting Bow Adept Move through the ordinary Move gates with focused coverage.
  - Record the completed vertical-slice Move evidence.
- [ ] **P11-025 — Implement `Gouge` natively** — `TODO`
  - Deliver the Honed Claws Master Move through the ordinary Move gates with focused coverage.
  - Certify interaction with the already-native `Wounding Strike` on the same item.
- [ ] **P11-026 — Implement `Titanic Slam` natively** — `TODO`
  - Deliver the Meteor Masher Master Move through the ordinary Move gates with focused coverage.
  - Certify interaction with the already-native `Backswing` on the same item.
- [ ] **P11-027 — Implement `Bullseye` natively** — `TODO`
  - Deliver the Super Lucky Throwing Stars Adept Move through the ordinary Move gates with focused coverage.
  - Certify ranged targeting semantics inherited from the profile.
- [ ] **P11-028 — Implement `Deadly Strike` natively** — `TODO`
  - Deliver the Super Lucky Throwing Stars Master Move through the ordinary Move gates with focused coverage.
  - Certify rank gating between the Adept and Master grants on one item.
- [ ] **P11-029 — Implement `Triple Threat` natively** — `TODO`
  - Deliver the Twin-Needled Bow Master Move through the ordinary Move gates with focused coverage.
  - Certify multi-target semantics against the existing targeting authority.
- [ ] **P11-030 — Certify the weapon-Move cohort** — `TODO`
  - Re-run complete Move coverage and all frozen-successor checks; certify trainer and Pokémon wielder eligibility, rank gates, source-loss withdrawal, and exact retry across all twelve weapon Moves.
  - Certify weapon Moves fail closed in Contest appeal legality and prove zero `definition-missing` Move grant rows remain.

### Phase 4 — Deferred item actions

- [ ] **P11-031 — Freeze the item-action closure matrix** — `TODO`
  - Confirm each of the eleven actions' target final state from the closure inventory — native, guided, or passive — with owning tickets and acceptance mapping; none may target reference-only.
  - Record custody, timing, duration, resource, and privacy requirements per action from the canonical rows.
- [ ] **P11-032 — Implement shield ready actions** — `TODO`
  - Implement Light and Heavy Shield readying as native standard actions installing typed duration effects — the canonical Evasion and Damage Reduction bonuses with the Slowed drawback until end of next turn — including the passive equipped bonuses, two-handed variants where canonical, and boundary expiry.
  - Certify stacking, re-ready, source-loss, and round-boundary semantics with focused coverage.
- [ ] **P11-033 — Implement Shock Collar activation** — `TODO`
  - Implement remote activation as a native action: exact one-sixth max Hit Point loss on the wearer through authoritative HP mutation with receipts, worn-collar and remote custody validation, and the reviewed Ground-type variant policy.
  - Certify the Press Feature interaction and role-safe consent and visibility semantics.
- [ ] **P11-034 — Implement the Glue Cannon attack** — `TODO`
  - Implement the AC 8 status attack through the existing status-attack pipeline: charge consumption, hit → Slowed, and the canonical critical-hit escalation, with receipts and history.
  - Certify no-charge, out-of-range, and duplicate-delivery behavior.
- [ ] **P11-035 — Implement the Hand Net attack** — `TODO`
  - Implement the AC 6 status attack netting a Small Pokémon: trapped state, move-with-target semantics, and escape/release paths through existing condition authority.
  - Certify size legality and stale-target validation codes.
- [ ] **P11-036 — Implement Weighted Nets throw and pull** — `TODO`
  - Implement the thrown AC 8 status attack installing the netted state and the separate standard-action pull moving the netted Pokémon one meter toward the wielder through map authority.
  - Certify throw/pull sequencing, escape, and both actions' exact retry.
- [ ] **P11-037 — Complete the netted and trapped condition family** — `TODO`
  - Unify the Hand Net and Weighted Nets restraint states into one reviewed typed condition family with escape, release, source-loss, and cleanup semantics integrated with existing condition and movement authority.
  - Certify projections and history for restrained participants across roles.
- [ ] **P11-038 — Implement the fishing action contract** — `TODO`
  - Implement rod fishing declarations: two-handed custody, water-adjacency eligibility policy, campaign-time cost, and the Skill Check integration point, reusing the exploration-item GM-prompt anatomy.
  - Certify declaration legality, cancellation, and reconnect behavior.
- [ ] **P11-039 — Implement fishing resolution as a guided outcome** — `TODO`
  - Resolve fishing through a bounded guided GM adjudication honoring rod-tier constraints (Old Rod: small unevolved level ≤ 10; Good and Super Rod: GM discretion within their canonical bounds), producing durable receipts and campaign attention items; what is hooked remains ordinary GM authority until Plan 12 tooling exists.
  - Certify that no fishing surface remains deferred and record the reviewed Plan 12 handoff boundary in the closure inventory.
- [ ] **P11-040 — Implement Snag Machine conversion** — `TODO`
  - Implement the portable and large variants with exact custody, Poké Ball → Snag Ball conversion through existing inventory transactions, and capture-authority integration for throws against owned Pokémon behind a bounded guided GM legality decision.
  - Certify conversion receipts, idempotency, and role-safe visibility of the act.
- [ ] **P11-041 — Complete item-action presentation and accessibility** — `TODO`
  - Retire all eleven deferred presentation reasons across the Action Dock, inventory, and sheet surfaces with role-correct offers and unavailable reasons only where mechanics legitimately forbid action.
  - Pass keyboard, touch, screen-reader, zoom, and reduced-motion checks on the changed surfaces.
- [ ] **P11-042 — Rebuild item registries after review** — `TODO`
  - Regenerate the grants, contributions, and cohort registries so every audited item action carries its final state, with drift gates and no unintentional changes to unrelated rows.
  - Re-run the affected generated-data checks and frozen-successor validations.
- [ ] **P11-043 — Certify item-action recovery and concurrency** — `TODO`
  - Certify exact retry, duplicate delivery, reconnect, restart, stale-revision conflict, and rollback behavior for all eleven actions with the Phase 1 fixtures.
  - Include cross-client realtime convergence for durable states like readied shields and netted targets.
- [ ] **P11-044 — Prove zero deferred core item actions** — `TODO`
  - Extend the rubric checker to fail on any remaining deferred, definition-missing, or deferral-flavored item-action row across the audited registries.
  - Record the item-action closure evidence in the closure inventory.

### Phase 5 — Generic liveplay Skill Checks

- [ ] **P11-045 — Implement the SkillCheckDocument and storage migration** — `TODO`
  - Add the versioned check document, schema migration, and repository plumbing: requester, subjects, skill identities, DC or opposed policy, state machine, journals, and settlement references.
  - Reject unknown schema versions and certify fresh-database and upgrade paths.
- [ ] **P11-046 — Implement server check authority** — `TODO`
  - Resolve skills and modifiers from authoritative sheets, roll journaled dice server-side, apply DC and opposed comparisons, and commit accepted results with revisions and idempotency.
  - Forbid client-supplied rolls and certify exact retry returns the original result.
- [ ] **P11-047 — Implement the GM check workflow** — `TODO`
  - Let the GM request single and group checks against trainers and Pokémon, set DCs from reviewed presets or explicit values, observe pending responses, and resolve or cancel with receipts.
  - Keep GM intent private until results are accepted where the reviewed contract requires it.
- [ ] **P11-048 — Implement the subject check workflow** — `TODO`
  - Prompt check subjects with role-correct requests, skill and modifier transparency, and accepted-result presentation consistent with existing decision surfaces.
  - Certify prompted, declined-where-legal, and timed-out paths with durable evidence.
- [ ] **P11-049 — Implement check projections and privacy** — `TODO`
  - Produce structurally distinct GM, subject, and spectator projections for pending and accepted checks and their history.
  - Certify no private modifier, note, or diagnostic leaks through any projection.
- [ ] **P11-050 — Integrate checks with consuming flows** — `TODO`
  - Route the fishing skill check and any closure-inventory rows that require generic checks through the new surface where the reviewed contract authorizes it, without breaking existing bespoke adjudications.
  - Record which flows intentionally keep their existing check machinery and why.
- [ ] **P11-051 — Complete check accessibility and liveplay acceptance** — `TODO`
  - Pass keyboard, touch, screen-reader, zoom, reflow, and reduced-motion checks and desktop/mobile liveplay journeys for request, response, and history surfaces.
  - Meet the existing decision-surface performance budgets.
- [ ] **P11-052 — Certify check recovery, concurrency, and history** — `TODO`
  - Certify reconnect, restart, duplicate delivery, stale revisions, and rollback for single and group checks.
  - Certify campaign history and attention integration for unresolved checks.

### Phase 6 — Trainer Participant Contests

- [ ] **P11-053 — Extend the ContestDocument to trainer performers** — `TODO`
  - Extend enrollment, contestant identity, and controller semantics so trainers enroll as performers beside their Pokémon without parallel sheet or dice authority.
  - Reject trainer enrollment in variants whose canonical rows do not permit it.
- [ ] **P11-054 — Implement the shared contest dice-pool policy** — `TODO`
  - Implement the canonical shared Trainer-plus-Pokémon Contest Stat Dice pool, including Coordinator-style Feature spend on either performer where canonical.
  - Certify single-spend accounting across the pair with journaled evidence.
- [ ] **P11-055 — Implement the canonical method policies** — `TODO`
  - Implement the reviewed method options from the successor variant row — simultaneous appeals with player-chosen order and separate voltage, and alternating appeals with shared voltage — as explicit per-contest policy choices.
  - Fail closed on any method semantics the canonical row does not define.
- [ ] **P11-056 — Implement the trainer introduction stage** — `TODO`
  - Run trainer introductions through the existing introduction authority with canonical skills, journaled rolls, and letter assignment for trainer performers.
  - Certify parity with Pokémon introductions in projections and history.
- [ ] **P11-057 — Implement trainer appeals** — `TODO`
  - Let trainers declare appeals from their real Move lists with canonical contest-type matching and effects; Moves without canonical contest identity — including weapon Moves — fail closed with explicit reasons.
  - Certify appeal, fumble, and scoring parity through the existing performance authority.
- [ ] **P11-058 — Implement paired voltage and adjacency semantics** — `TODO`
  - Implement the canonical voltage bookkeeping for both methods and adjacency effects that address both members of a pair.
  - Certify center-of-attention and position chart behavior with paired performers.
- [ ] **P11-059 — Integrate Features, Edges, Abilities, and items for trainer performers** — `TODO`
  - Extend the existing intervention cohort to trainer performers where the canonical rows permit, through the shared offer and decision anatomy.
  - Re-run the affected integration-row coverage without regressing the 44 finalized rows.
- [ ] **P11-060 — Implement paired projections and privacy** — `TODO`
  - Extend scoreboard, owner, GM, and spectator projections to paired entries without leaking private planning between competitors.
  - Certify structural distinctness across all roles.
- [ ] **P11-061 — Implement Trainer Participant settlement** — `TODO`
  - Settle placements, experience, ribbons, and prizes for contests with trainer performers through the existing atomic settlement authority under the reviewed canonical experience rules.
  - Certify exact retry and no duplicate rewards.
- [ ] **P11-062 — Complete Trainer Participant UI and accessibility** — `TODO`
  - Deliver enrollment, stage, and scoreboard surfaces for paired entries meeting the existing Contest accessibility and responsive budgets.
  - Pass desktop/mobile liveplay journeys.
- [ ] **P11-063 — Extend the deterministic variant matrix** — `TODO`
  - Add seeded Trainer Participant scenarios across supported contestant counts and base variants with expected letters, scores, voltage, and placements.
  - Bind them to the successor canonical fingerprints.
- [ ] **P11-064 — Certify Trainer Participant Contests** — `TODO`
  - Certify replay, recovery, realtime, correction, and multi-client convergence for paired contests with the Phase 1 fixtures.
  - Prove the `trainer-participant` variant row ends `native`.

### Phase 7 — Battle Contests

- [ ] **P11-065 — Define the reviewed blend contract** — `TODO`
  - Define the ContestDocument ↔ EncounterDocument boundary: linkage identity, typed handoff facts from accepted encounter results to contest scoring, revision and idempotency coupling, and the atomicity policy for cross-engine transitions.
  - Forbid cross-document writes; each engine commits only its own documents.
- [ ] **P11-066 — Implement Battle Contest setup** — `TODO`
  - Implement two-trainer setup with per-trainer Pokémon counts (3–6) and the canonical round budget of twice the per-trainer count, through the existing Contest Workshop flow.
  - Validate rosters, eligibility, and consent under existing authority.
- [ ] **P11-067 — Implement the Battle Contest introduction stage** — `TODO`
  - Run per-trainer introductions generating Contest Stat Dice pools usable by any of that trainer's Pokémon, without affecting initiative.
  - Certify pool custody and single-spend accounting across team members.
- [ ] **P11-068 — Create and link the battle encounter** — `TODO`
  - Create the linked encounter through existing encounter authority — initiative, placement, and turn order as a normal battle — bound to the contest by the blend contract.
  - Certify that neither document can advance without the other's required facts.
- [ ] **P11-069 — Implement appeal rolls on accepted Move results** — `TODO`
  - Score an Appeal Roll for each performed Move from the encounter's accepted results through typed handoff facts, excluding Struggle Attacks and maneuvers per canon.
  - Certify appeals never mutate encounter documents and battle results never mutate contest documents directly.
- [ ] **P11-070 — Implement battle-mode contest effect semantics** — `TODO`
  - Apply the canonical battle-mode reinterpretations: all opposing Pokémon count as adjacent, and contest effects resolve against the battle context per the successor variant row.
  - Fail closed on any effect whose battle-mode semantics the canonical row does not define, with explicit reasons.
- [ ] **P11-071 — Implement per-Pokémon voltage ledgers** — `TODO`
  - Track voltage per team Pokémon with only the active Pokémon's voltage applying to appeals.
  - Certify ledger projections across GM, owners, and spectators.
- [ ] **P11-072 — Implement KO, damage-over-time, and recall voltage rules** — `TODO`
  - Implement +2 voltage for attack KOs, the damage-over-time KO redirection to the opponent's active Pokémon, and −2 voltage on recall with the canonical Baton Pass, U-Turn, Volt Switch, and Juggler-style exceptions.
  - Drive these from authoritative encounter lifecycle facts, never client claims.
- [ ] **P11-073 — Implement replacement center-of-attention semantics** — `TODO`
  - Place a replacement sent out after a KO in the Center of Attention for its first acting turn per canon.
  - Certify interaction with existing center-of-attention scoring.
- [ ] **P11-074 — Implement Battle Contest end conditions** — `TODO`
  - End the contest at round-budget exhaustion or when one side's Pokémon are all knocked out, tally appeal points, and determine the winner.
  - Certify both end paths with deterministic fixtures.
- [ ] **P11-075 — Prove single-spend and convergent randomness across engines** — `TODO`
  - Certify Move frequencies, action resources, contest dice, and journaled rolls each spend exactly once with convergent evidence across both documents under retry, duplicate delivery, and reconnect.
  - Fail acceptance on any divergence between engine journals.
- [ ] **P11-076 — Implement cross-engine interruption, restart, and correction** — `TODO`
  - Support GM cancellation, restart mid-round, server restart, and bounded corrections across the linked documents without orphan authority or partial scoring.
  - Certify recovery with the Phase 1 dual-engine fixtures.
- [ ] **P11-077 — Implement Battle Contest settlement** — `TODO`
  - Settle appeal placements, canonical contest experience, ribbons, and prizes atomically, reconciling with encounter settlement so no reward or consequence double-applies.
  - Certify exact retry across the combined settlement boundary.
- [ ] **P11-078 — Complete the Battle Contest liveplay experience** — `TODO`
  - Deliver the joined cockpit: tactical encounter surface plus contest scoreboard with role-correct projections for GMs, competing owners, and spectators.
  - Meet existing encounter and Contest accessibility and performance budgets on desktop and mobile.
- [ ] **P11-079 — Add deterministic Battle Contest fixtures** — `TODO`
  - Add seeded scenarios at minimum and maximum scale (3 and 6 Pokémon per side) covering KO endings, budget endings, switching, and voltage rules with expected tallies and placements.
  - Bind them to the successor canonical fingerprints.
- [ ] **P11-080 — Certify Battle Contests** — `TODO`
  - Certify privacy, realtime convergence, performance, multi-client behavior, and exact retry across both engines with all fixtures passing.
  - Prove the `battle` variant row ends `native`.

### Phase 8 — Integrated zero-deferred closure

- [ ] **P11-081 — Run integrated golden journeys** — `TODO`
  - Run cross-subsystem journeys spanning ranged equipment, weapon Moves, item actions, Skill Checks, encounters, both new Contest variants, settlement, and campaign continuation on seeded campaigns.
  - Record journey evidence in the closure inventory.
- [ ] **P11-082 — Certify migration and upgrade paths** — `TODO`
  - Certify fresh-database creation and historical campaign upgrades across every schema change this plan introduced, with no manual repair.
  - Include downgrade-refusal behavior for unknown schema versions.
- [ ] **P11-083 — Certify backup, restore, restart, and reconnect** — `TODO`
  - Certify backup/restore round-trips and restart/reconnect behavior for the new documents and states — checks, readied shields, netted targets, linked Battle Contests — without lost or duplicated authority.
  - Use the existing operator backup workflow, not new tooling.
- [ ] **P11-084 — Pass the final accessibility audit** — `TODO`
  - Pass Axe, keyboard, screen-reader, zoom, reflow, and reduced-motion audits across every surface this plan added or changed.
  - Record zero hard failures.
- [ ] **P11-085 — Meet performance budgets** — `TODO`
  - Validate the new surfaces against the existing lower-end-laptop, mobile, and large-campaign budgets, including dense ranged targeting and dual-engine Battle Contests.
  - Enforce them in focused benchmarks.
- [ ] **P11-086 — Pass the final privacy and role-projection audit** — `TODO`
  - Audit every new projection — weapons, item actions, checks, paired and battle contests — for structural role distinctness and absence of private leaks.
  - Bind the audit to executable checks, not review notes.
- [ ] **P11-087 — Complete documentation closure** — `TODO`
  - Update contributor, operator, GM, and player documentation for every new surface and retire all stale deferred-state language repository-wide.
  - Validate documentation links and executable claims.
- [ ] **P11-088 — Complete drift and forbidden-gap gates** — `TODO`
  - Extend the generated-data and drift checks to cover every repaired registry row, successor chain, and new document type; fail on unregistered rows, orphan handlers, or deferral-flavored states.
  - Wire the new checks into the repository quality gate.
- [ ] **P11-089 — Publish the zero-deferred closure proof** — `TODO`
  - Regenerate the closure inventory with every row in a final state and publish the machine-readable acceptance record under `data/deferred-closure/`.
  - The rubric checker must prove zero known deferred, blocked, prose-inferred, or silently absent core mechanics rows across all ledgers and registries.
- [ ] **P11-090 — Pass full repository validation** — `TODO`
  - Run the full test suite, typecheck, lint, production build, and `scripts/quality-gate.sh` to completion under the bounded-worker discipline.
  - Resolve every regression before proceeding.
- [ ] **P11-091 — Pass final desktop and mobile liveplay acceptance** — `TODO`
  - Run the golden journeys in production-build liveplay on desktop and mobile with multi-client convergence and no critical usability defects.
  - Record visual and trace evidence.
- [ ] **P11-092 — Record final acceptance and archive the plan** — `TODO`
  - Confirm all 92 tickets and the zero-deferred proof, set `PLAN_STATUS: DONE`, archive this ledger to `implementation-plans/done/`, and synchronize `plan-order.md` and `AGENTS.md`.
  - Draft and register the GM Campaign Toolkit scope from the plan-order 1.0 release definition as the next prospective conversion, without activating it.

## Phase exit gates

### Phase 1 exit

- The closure inventory, registry-finality decision, source-fingerprint policy, generator and registry extensions, successor Contest variant rows, Skill Check contract, completion rubric, and all acceptance fixtures exist as reviewed artifacts, and P11-001 through P11-010 are `DONE`.

### Phase 2 exit

- All six ranged profiles are native end to end with presentation, accessibility, and cohort certification, the vertical slice is complete in liveplay, and P11-011 through P11-022 are `DONE`.

### Phase 3 exit

- All twelve weapon Moves are native, Move coverage and frozen-successor checks pass, Contest appeal exclusion is certified, and P11-023 through P11-030 are `DONE`.

### Phase 4 exit

- All eleven item actions are final with rebuilt registries, recovery certification, and the zero-deferred item-action proof, and P11-031 through P11-044 are `DONE`.

### Phase 5 exit

- The Skill Check surface is complete with GM and subject workflows, projections, integrations, accessibility, and recovery certification, and P11-045 through P11-052 are `DONE`.

### Phase 6 exit

- Trainer Participant Contests are native across enrollment, dice, methods, appeals, voltage, interventions, settlement, UI, fixtures, and certification, and P11-053 through P11-064 are `DONE`.

### Phase 7 exit

- Battle Contests are native across the blend contract, setup, introduction, linked combat, appeals, voltage, end conditions, single-spend proofs, recovery, settlement, UI, fixtures, and certification, and P11-065 through P11-080 are `DONE`.

### Phase 8 exit

- Integrated journeys, migration, backup/restore, accessibility, performance, privacy, documentation, drift gates, the zero-deferred proof, full validation, and liveplay acceptance pass, P11-081 through P11-092 are `DONE`, and the plan is archived.

## Final definition of done

This plan is complete only when all of the following are true:

1. All 92 tickets are `DONE` with recorded evidence.
2. The closure inventory ends with every audited row in a final reviewed state and zero deferred, blocked, definition-missing, prose-inferred, or silently absent core mechanics rows anywhere in the ledgers and registries.
3. All six ranged weapon profiles, all twelve weapon Moves, and all eleven item actions are mechanically final in liveplay.
4. The generic Skill Check surface is complete and integrated.
5. The `trainer-participant` and `battle` variant rows are `native` with deterministic fixtures and certified dual-engine guarantees.
6. Frozen Plan 1–10 acceptance records remain intact behind explicit successor chains.
7. Full-suite validation, the production build, the repository quality gate, migration and backup/restore certification, and desktop/mobile liveplay acceptance pass.
8. `plan-order.md` and `AGENTS.md` are synchronized, and the GM Campaign Toolkit draft is registered for review.

## Decision record (auto-appended)

- **2026-08-22 — Activate the Plan 11 ledger from the reviewed draft.** The P10-100 draft at `implementation-plans/drafts/DEFERRED_MECHANICS_CLOSURE_PLAN.md` was reviewed against repository evidence, amended with the registry-observed baseline, and converted into this authoritative 92-ticket ledger. The draft file remains as a superseded pointer.
- **2026-08-22 — Sources and fingerprints (draft question 1).** The weapon, Move, and item-action remediations are authorized by the canonical `data/reference/items.json` rows (identity, class, granted-Move names, effect prose; every affected row sources `09-gear-and-items.md`) plus reviewed hash-bound extensions fingerprinted to `books/markdown/core/09-gear-and-items.md` and the errata files, following the equipment-grants generator and `contests.json` fingerprint patterns. The Contest variant remediation reuses the existing `contests.json` source set through a successor migration.
- **2026-08-22 — Weapon-Move canonical home (draft question 2).** The seven definitions extend the reviewed weapon-Move registry (`shared/capabilityAutomation/weaponMoves.ts` and its equipment-grant consumers), whose recorded precedent deliberately keeps supplemental weapon Moves outside the frozen `data/reference/moves.json` Pokémon catalog. Plan 10's 777/761/16 contest-coverage records stay frozen and untouched; weapon Moves fail closed in Contest appeal legality because they have no canonical contest identity.
- **2026-08-22 — Item-action scope (draft question 3).** All eleven deferred actions belong to canonical `data/reference/items.json` rows sourced from the core gear chapter; none are supplemental. All eleven are in scope with target states native or guided.
- **2026-08-22 — Rod-fishing boundary (draft question 4).** Plan 11 delivers fishing as final mechanics: declaration, custody, eligibility, time cost, Skill Check, and a bounded guided GM hook adjudication with receipts and attention items. What is hooked remains ordinary GM authority; Plan 12 may later automate generation without reopening the action. No rod action remains deferred at Plan 11 exit.
- **2026-08-22 — Variant scales (draft question 5).** Reviewed canon constrains the matrices: Trainer Participant layers trainer performers onto the existing three-to-five-contestant variants under two canonical method policies, while Battle Contests are two-trainer events with three to six Pokémon per side and a round budget of twice the per-trainer count. The 3/4/5 Standard matrix does not apply to Battle Contests.
- **2026-08-22 — Battle Contest architecture (draft question 6).** One reviewed blend contract joins the two engines: the ContestDocument and EncounterDocument stay separate authorities linked by typed handoff facts derived from accepted encounter results; neither engine writes the other's documents; single-spend, convergent-randomness, and atomic-settlement proofs are explicit tickets (P11-065, P11-069, P11-075, P11-077).
- **2026-08-22 — Generic Skill Checks (draft question 7).** The gap is confirmed: only item- and move-embedded check machinery exists. Phase 5 builds the small server-authoritative SkillCheckDocument surface reusing sheet skills, journaled dice, role projections, and campaign history.
- **2026-08-22 — Ticket count (draft question 8).** 92 tickets across eight phases, sized so each ticket is one reviewable seam of an existing authority; the closure inventory (P11-001) may split or annotate rows but any ticket-count change must synchronize this ledger, `plan-order.md`, and `AGENTS.md`.
