# Deferred Mechanics Closure Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: P11-059`

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

- Plan tickets: **41 DONE / 92 total**
- Current ticket: **P11-042**
- Blocking dependency: **none; Plans 1–10 are complete and archived**
- Closure targets at activation: **6 ranged weapon profiles, 7 weapon Moves, 11 item actions, 2 Contest variants, 1 Skill Check surface, plus the reconciled inventory**
- Known contradictions at activation: **grant-level deferred states vs. cohort-level `passive` finality remains scheduled for P11-042; stale Plan 8 pointers were re-homed and stale trigger-deferral language retired by P11-002**

## Tickets

### Phase 1 — Closure inventory, reviewed authority, and fixtures

- [x] **P11-001 — Build the versioned closure inventory** — `DONE`
  - Reconcile every prior plan's deferred, assisted, visible-with-reason, reference-only, and explicit non-goal rows into one versioned inventory with stable IDs, owning app paths, canonical-data status, privacy implications, current-vs-target states, and proposed acceptance evidence, separating genuine core gaps from supplemental or post-1.0 content and stale documentation.
  - Resolve the grant-level versus cohort-level finality contradiction by declaring which registry surface the final zero-deferred proof reads, and record the decision in the inventory artifact under `data/deferred-closure/`.
  - Evidence: `data/deferred-closure/closure-inventory.v1.json` records the activation baseline — 29 rows (27 mechanics: 6 weapon profiles, 7 weapon Moves with registry grant bindings, 11 item actions with stale-pointer facts, 2 Contest variants, 1 runtime surface; plus 2 hygiene rows) and 8 reviewed non-gaps with classifications. The finality decision names the grants registry, `contests.json`, and the inventory itself as the zero-deferred read surfaces and demotes cohort `implementationState` to derived presentation reconciled at P11-042 and proved at P11-089. Frozen-source hashes bind `items.json` and `moves.json`; mutable surfaces record observed hashes and expected mutations. `tests/data/deferredClosureInventory.test.ts` (8 tests) validates structure, ledger-ticket references, frozen sources, canonical identity bindings, monotone closure progress in the grants registry and contest variants, the finality decision, and non-gap/registry completeness; all pass under bounded workers.
- [x] **P11-002 — Re-home stale deferred pointers and stale documentation** — `DONE`
  - Repoint all eleven `deferredTicket` values in the equipment-grants generator and registry from completed Plan 8 tickets to their owning Plan 11 tickets and regenerate the registry with drift checks.
  - Verify or retire stale deferred-state documentation, including the `docs/live-play-authority.md` claim that concrete move/field trigger registrations remain deferred to their owning tickets.
  - Evidence: the reviewed generator now points the three rod actions to P11-038, Glue Cannon to P11-034, Hand Net to P11-035, both Weighted Nets actions to P11-036, both shields to P11-032, Snag Machine to P11-040, and Shock Collar to P11-033; the regenerated registry passes `generate_complete_play_loop_equipment_grants.py --check`, and the P11 inventory's pointer-ownership test passes. `docs/live-play-authority.md` now states the verified typed-registration/fail-closed policy rather than carrying stale deferred language.
- [x] **P11-003 — Record the reviewed source-fingerprint and successor policy** — `DONE`
  - Record the exact documentary fingerprints (including `books/markdown/core/09-gear-and-items.md`, `08-pokemon-contests.md`, and the errata files) that authorize the weapon, Move, item-action, and Contest-variant remediations, plus the successor-chain policy for every frozen Plan 1–10 acceptance record these changes touch.
  - Fail closed on any identity the fingerprinted sources do not define; file explicit data defects instead of interpreting prose at runtime.
  - Evidence: `data/deferred-closure/source-authority.v1.json` binds the exact gear, Contest, and two errata byte hashes, app-owned identity sets, explicit fail-closed defect policy, and eight byte-immutable Plan 3/8/10 records. `data/deferred-closure/successor-chain.v1.json` records the first contiguous P11-002 edge and pending mutable heads. `tests/data/deferredClosureSourceAuthority.test.ts` verifies all fingerprints, identities, frozen records, and chain continuity (5 tests; passing with the inventory gate).
- [x] **P11-004 — Extend the equipment-grants generator with ranged weapon classes** — `DONE`
  - Encode the reviewed short-range and long-range class semantics — range values, damage-base contribution, accuracy behavior, hands, wielder policy, and ammunition/charge policy — in the reviewed generator, bound to the recorded fingerprints, mirroring how melee classes carry `damageBaseBonus` and `accuracyCheckPenalty`.
  - Regenerate `data/complete-play-loop/equipment-grants.v1.json` so all six profiles become `native` grant rows, with generator drift checks and no change to unrelated grants.
  - Evidence: the generator and strict parser now encode all four reviewed class policies, exact 0–4m and 4–12m ranged bands, AC/DB contributions, one/two-handed custody, trainer-only ranged Wielder policy, range replacement, no STAB, and explicit abstracted-ammunition/no-invented-recovery semantics bound to the gear-source hash. All six ranged rows are native; the P11-004 successor edge is contiguous. Generator drift plus 20 focused inventory/source/class/grant tests pass.
- [x] **P11-005 — Extend the reviewed weapon-Move registry with the seven definitions** — `DONE`
  - Add `Bash!`, `Pierce!`, `Gouge`, `Titanic Slam`, `Bullseye`, `Deadly Strike`, and `Triple Threat` to the reviewed weapon-Move registry with stats from the fingerprinted weapon chapter, following the documented precedent that supplemental weapon Moves live outside the frozen `data/reference/moves.json` catalog.
  - Leave Plan 10's 777/761/16 contest-coverage records untouched, and certify that weapon Moves without canonical contest identity fail closed in Contest appeal legality.
  - Evidence: the source-bound supplemental registry now contains all twelve weapon Moves and exact reviewed stats/effects, while executable status remains independently gated for Phase 3. The frozen 777-row Pokémon Move catalog and Plan 10 records are byte-unchanged. A real Contest performer snapshot rejects all twelve with `contest.move-identity-missing`; 20 focused weapon/source/inventory tests pass.
- [x] **P11-006 — Upgrade the Contest variant rows through a successor migration** — `DONE`
  - Upgrade the `trainer-participant` and `battle` rows in `data/reference/contests.json` from `reference-only` to structured semantics through a reviewed source-hash-bound successor migration: method policies, shared dice-pool policy, and voltage policies for Trainer Participant; trainer count, per-trainer Pokémon counts (3–6), round budget (twice the per-trainer count), adjacency, voltage, KO/recall, replacement, and end-condition rules for Battle Contests.
  - Preserve the existing variant rows and fingerprints through the successor chain and fail closed where the fingerprinted chapter and errata do not define a value.
  - Evidence: the new reviewed migration manifest and deterministic checker install one exact successor of the frozen Plan 10 catalog. Both rows are now `structured` without deferral reasons and carry the two Trainer Participant methods/shared pool plus complete Battle scale, rounds, appeals, adjacency, voltage, KO/recall, replacement, and end policies. The old 777/761/16 authority remains frozen and admitted only through the contiguous successor. Both migration checks and 25 focused canonical/closure tests pass.
- [x] **P11-007 — Define the generic Skill Check contract** — `DONE`
  - Record the reviewed no-existing-surface evidence, then define the `SkillCheckDocument` and operation contract: requester and subject identities, canonical sheet skill identities, DC and opposed policies, modifier resolution, journaled dice, accepted results, revisions, idempotency, and privacy boundaries.
  - Keep the contract generic enough for core campaign adjudication without becoming a narrative-generation or automation-scripting subsystem.
  - Evidence: `skill-check-contract.v1.json` pins the six reviewed embedded-check authorities proving no prior generic surface and defines all 17 sheet skills, DC/opposed policies, 1–32 subjects, server-only journaled d6s, exact retries, corrections, and structural privacy. `shared/skillChecks/contract.ts` supplies typed documents/commands, stable IDs, transitions, and fail-closed invariants. Six contract tests plus the inventory gate pass (14 assertions total).
- [x] **P11-008 — Define the Plan 11 completion rubric and evidence registry** — `DONE`
  - Bind every closure-inventory row to its target final state, owning ticket, and machine-checkable acceptance evidence in a versioned rubric under `data/deferred-closure/`.
  - Forbid new deferred states structurally: the rubric checker must fail on any `definition-missing`, `deferred`, or deferral-flavored reason code in the audited registries.
  - Evidence: `completion-rubric.v1.json` maps all 29 rows to final states, closure tickets, authority paths, and registered evidence. `check_deferred_closure.py` reports 8 final/21 registered activation debts, rejects unregistered debt immediately, and exposes a strict final mode that currently fails as intended. Six rubric tests plus inventory checks pass (14 tests), including proof that the final gate refuses every debt flavor.
- [x] **P11-009 — Create deterministic acceptance fixtures for weapons, Moves, and item actions** — `DONE`
  - Add seeded fixtures binding expected range legality, accuracy, damage, effect, duration, custody, and receipt outcomes for all six profiles, seven Moves, and eleven item actions to canonical source fingerprints.
  - Include trainer and Pokémon wielders, rank gates, and at least one illegal declaration per surface with its stable validation code.
  - Evidence: `mechanics-acceptance-fixtures.v1.json` provides 24 unique seeded, source-record-bound cases (6/7/11) with exact ranges, AC/DB, damage formulas, effects, durations, custody, receipts, rank gates, Trainer/Pokémon Wielder cases, and stable illegal codes. The fixture policy explicitly records conservative item range, fishing interval, and fraction rounding decisions. Six fixture tests and the existing authority suites pass (14 focused tests).
- [x] **P11-010 — Create failure, concurrency, and recovery fixtures** — `DONE`
  - Add deterministic fixtures for stale revisions, duplicate declarations, reconnects, restarts mid-action, interrupted settlements, and dual-engine conflicts for every new surface, each defining public, owner, and GM projections plus retry and rollback expectations.
  - Bind the Battle Contest fixtures to both documents so no partial cross-engine state can pass acceptance.
  - Evidence: `failure-recovery-fixtures.v1.json` covers all 27 mechanics surfaces with unique seeds, common stale/duplicate/reconnect/restart contracts, atomic interruption cases, and structurally distinct public/owner/GM fields. Four Battle fixtures bind exact Contest and Encounter revisions for stale sides, duplicate handoff, and interrupted settlement with zero partial writes. Six recovery-fixture tests plus the mechanics fixture suite pass (12 tests).

### Phase 2 — Ranged weapon profiles

- [x] **P11-011 — Extend weapon selector and sheet authority to ranged classes** — `DONE`
  - Extend the opaque weapon-selector presentation identities, exact sheet revalidation, and equipment custody checks to short-range and long-range profiles for trainer and eligible Pokémon wielders.
  - Preserve the existing rule that descriptive held or slot text grants nothing.
  - Evidence: all six native profile rows now flow through the existing opaque `attack-source.v1` selector, active equipment-instance/hash revalidation, exact one/two-hand slot custody, suppression, and trainer-only ranged eligibility. Structured trainer custody projects sourced Struggle offers; a Wielder Pokémon, one-handed long bow, and descriptive slot text grant nothing. `tests/server/equipmentGrantProjection.test.ts` covers the matrix and passes with 11 focused cases.
- [x] **P11-012 — Implement ranged range and targeting legality** — `DONE`
  - Enforce canonical range values, line-of-sight, and target legality for ranged weapon attacks through the existing map targeting authority, with stable validation codes for out-of-range and blocked declarations.
  - Cover both weapon classes and reuse existing cover/visibility semantics without forking them.
  - Evidence: equipment profiles replace the sourced Move's Melee keyword with reviewed 0–4m or 4–12m bands. The ordinary single- and multi-target resolvers now parse and enforce the explicit minimum alongside the existing maximum and unchanged line-of-sight/cover authority. Focused runtime cases prove legal short/long attacks and stable `target-out-of-range` and `target-line-of-sight-blocked` failures; range-helper, profile, and projection suites pass (19 tests).
- [x] **P11-013 — Implement ammunition, charge, and recovery semantics** — `DONE`
  - Implement the reviewed ammunition/charge policy per profile — including thrown-weapon recovery where canonical — through existing inventory custody and consumption authority with receipts and exact retry.
  - Fail closed on any profile whose fingerprinted sources define no consumable semantics rather than inventing them.
  - Evidence: the fingerprint-bound class policy explicitly resolves every profile to abstracted ammunition with no tracked consumption and no canonically defined projectile recovery; the strict parser rejects invented policies. Ranged execution consequently creates no inventory spend/recovery operation or phantom no-ammunition gate, while exact source custody remains required. All 12 profiles pass the source/policy drift suite, and runtime evidence confirms accepted attacks contain no invented ammunition receipt.
- [x] **P11-014 — Route ranged weapon attacks through the attack executor** — `DONE`
  - Resolve ranged weapon attacks through the existing weapon-attack execution path: server-rolled accuracy against evasion, damage-base resolution with the class contribution, crit handling, injuries, and accepted results with history.
  - Certify no divergence from melee weapon attack semantics except the reviewed class differences.
  - Evidence: sourced ranged Struggle entries now enter the unchanged authoritative Move resolver and attack executor. The selected profile modifies only reviewed range, AC, and DB fields before the ordinary server accuracy roll, evasion, crit, damage, injury, usage, accepted-result, and history paths. Focused execution proves a journaled accuracy roll and exact long-range +1 AC/+1 DB delta over short-range; existing melee behavior remains on the previous branch.
- [x] **P11-015 — Complete the Weighted Rope profile** — `DONE`
  - Deliver the native short-range profile end to end: offers, declaration, targeting, resolution, receipts, and the retirement of its safe-unavailable reason.
  - Add focused coverage for its reviewed class semantics and custody.
  - Evidence: Weighted Rope now projects one opaque sourced Struggle offer, exact one-hand readiness, 4m line-of-sight targeting, abstract ammunition, and no obsolete unsupported offer. A legal attack enters the normal journaled executor while >4m fails `target-out-of-range`; structured custody and trainer-only eligibility are covered by the six-profile matrix.
- [x] **P11-016 — Complete the Slingshot profile** — `DONE`
  - Deliver the native long-range profile end to end with its reviewed ammunition policy.
  - Add focused coverage including out-of-range and no-ammunition validation codes.
  - Evidence: Slingshot now projects native exact two-hand readiness and the 4–12m line-of-sight band with +1 AC/+1 DB through the common executor. The reviewed source explicitly abstracts ammunition, so the strict policy rejects an invented no-ammunition state rather than exposing a false validation code; minimum/maximum failures retain `target-out-of-range`. Matrix and policy-drift tests pass.
- [x] **P11-017 — Complete the Throwing Hammers profile** — `DONE`
  - Deliver the native short-range profile end to end, including thrown recovery semantics where canonical.
  - Wire the Adept-rank `Bash!` grant eligibility so the Phase 3 Move lands on live custody facts.
  - Evidence: Throwing Hammers has the native one-hand 0–4m profile with no invented recovery transaction and grants `Bash!` from exact Adept+ custody. Focused native execution proves ordinary damage plus the source-linked Initiative 0 effect only on a natural 15+, with a below-threshold no-op and journaled evidence.
- [x] **P11-018 — Complete the Hunting Bow profile** — `DONE`
  - Deliver the native long-range profile end to end and wire Adept-rank `Pierce!` grant eligibility.
  - Complete the first playable vertical slice in desktop and mobile liveplay and record its evidence.
  - Evidence: exact two-hand Hunting Bow custody exposes native 4–12m Struggle and `Pierce!` offers through the responsive generic Action Dock contract; declarations use opaque source identity, authoritative LoS/range, journaled attack rolls, +1 AC/+1 DB, accepted results, and history. `Pierce!` contributes +10 only when server-resolved target Damage Reduction exists. The role projection and native runtime vertical-slice tests pass; no component-specific visual branch or browser-authored mechanic was introduced.
- [x] **P11-019 — Complete the Super Lucky Throwing Stars profile** — `DONE`
  - Deliver the native short-range profile end to end and wire `Bullseye` and `Deadly Strike` grant eligibility at their canonical ranks.
  - Include any reviewed luck semantics the fingerprinted sources define, failing closed otherwise.
  - Evidence: the one-hand 0–4m profile is native and exact rank/source custody exposes `Bullseye` at Adept and trainer-only `Deadly Strike` at Master. Their only reviewed luck semantics are encoded explicitly: Bullseye crits on natural 16+ and Deadly Strike is a critical hit on every ordinary hit, both honoring critical prevention. Focused native executions prove each path without prose parsing.
- [x] **P11-020 — Complete the Twin-Needled Bow profile** — `DONE`
  - Deliver the native long-range profile end to end and wire `Triple Threat` grant eligibility beside the already-native `Double Swipe`.
  - Certify mixed native-plus-new grant presentation on one item.
  - Evidence: Twin-Needled Bow now supplies its exact two-hand 4–12m profile and exposes both `Double Swipe` and `Triple Threat` as available opaque-source offers at their respective ranks. Triple Threat requires exactly three server-ordered legal targets and inherits the profile minimum, maximum, and LoS checks. The focused projection asserts both Moves coexist and the three-target native execution passes.
- [x] **P11-021 — Complete ranged weapon presentation and accessibility** — `DONE`
  - Retire all six deferred presentation reasons from the Action Dock, sheet, and inventory surfaces; project range, ammunition, and readiness facts role-safely.
  - Pass keyboard, touch, screen-reader, zoom, and reduced-motion checks on the new surfaces.
  - Evidence: native sourced Move offers replace every ranged `action.unsupported` placeholder. Role-safe passive facts now expose weapon range, exact ready-hand count, and the reviewed abstract-ammunition policy without serialized equipment identity; targeting summaries expose LoS and the complete band. This was an exact data projection through already-certified responsive/action primitives (no open visual design choice, so mockup generation was intentionally skipped). The Action Dock component suite (20 tests) and encounter design-system gate pass.
- [x] **P11-022 — Certify the ranged weapon cohort** — `DONE`
  - Certify ownership, custody, source loss, suppression, exact retry, correction, realtime convergence, and performance across all six profiles with the Phase 1 fixtures.
  - Regenerate the grants registry and prove zero `definition-missing` weapon-profile rows remain.
  - Evidence: the regenerated registry has 12/12 native profiles and zero profile debt; its deterministic generator check passes. The cohort matrix covers exact custody, trainer-only ranged eligibility, suppression/source loss, private opaque identities, both range classes, execution, and stable failures. Existing accepted-Move command idempotency/correction/realtime paths are reused unchanged. Seven focused suites pass 44 tests, the design gate passes, and the closure progress gate reports all six profile rows final.

### Phase 3 — Weapon Move execution

- [x] **P11-023 — Implement `Bash!` natively** — `DONE`
  - Route the Move through the existing offer, legality, execution, accepted-result, and history gates from Throwing Hammers custody at Adept rank.
  - Add focused execution and validation coverage bound to the Phase 1 fixtures.
  - Evidence: `Bash!` is now a native MoveSpec from exact Throwing Hammers/Adept custody. It uses standard accuracy/damage/usage/history and a typed source-linked Initiative-set effect gated by the same authoritative natural accuracy roll at 15+, with one-round expiry. Focused hit and below-threshold executions pass.
- [x] **P11-024 — Implement `Pierce!` natively** — `DONE`
  - Deliver the Hunting Bow Adept Move through the ordinary Move gates with focused coverage.
  - Record the completed vertical-slice Move evidence.
  - Evidence: the exact-source Hunting Bow offer resolves `Pierce!` through ordinary frequency, range, accuracy, damage, accepted-result, and history gates. The shared damage pipeline adds the reviewed +10 pre-type modifier only when authoritative sheet, encounter-effect, or equipment Damage Reduction exists; focused with/without-DR executions certify the distinction and complete the vertical slice.
- [x] **P11-025 — Implement `Gouge` natively** — `DONE`
  - Deliver the Honed Claws Master Move through the ordinary Move gates with focused coverage.
  - Certify interaction with the already-native `Wounding Strike` on the same item.
  - Evidence: `Gouge` is a native two-strike per-hit-accuracy execution from trainer Master Honed Claws custody. The typed follow-up filters the Injury operation to a target whose two authoritative strikes both hit, then records exactly one explicit Injury operation; normal HP-marker Injuries remain separate. Honed Claws continues to co-project native Adept `Wounding Strike` and Master `Gouge` grants.
- [x] **P11-026 — Implement `Titanic Slam` natively** — `DONE`
  - Deliver the Meteor Masher Master Move through the ordinary Move gates with focused coverage.
  - Certify interaction with the already-native `Backswing` on the same item.
  - Evidence: `Titanic Slam` now resolves its DB 11/AC 3 attack and applies a source-linked one-round Slowed condition only when the same authoritative accuracy roll is even. The native condition operation and recipient are covered at execution; Meteor Masher retains its native Adept `Backswing` beside the Master grant.
- [x] **P11-027 — Implement `Bullseye` natively** — `DONE`
  - Deliver the Super Lucky Throwing Stars Adept Move through the ordinary Move gates with focused coverage.
  - Certify ranged targeting semantics inherited from the profile.
  - Evidence: `Bullseye` is native from exact Adept Throwing Stars custody, inherits the 0–4m LoS profile, and supplies a reviewed inclusive natural-16 critical trigger to the ordinary critical/damage pipeline. Focused execution records a true critical at 16 without overriding prevention.
- [x] **P11-028 — Implement `Deadly Strike` natively** — `DONE`
  - Deliver the Super Lucky Throwing Stars Master Move through the ordinary Move gates with focused coverage.
  - Certify rank gating between the Adept and Master grants on one item.
  - Evidence: `Deadly Strike` is native from trainer Master Throwing Stars custody and declares an always-critical policy only after ordinary accuracy succeeds, honoring prevention. The grant registry retains Adept `Bullseye` at rank 4 and trainer-only `Deadly Strike` at rank 6; exact rank filtering occurs before offer and execution authority. Focused execution proves a non-natural-critical hit becomes critical.
- [x] **P11-029 — Implement `Triple Threat` natively** — `DONE`
  - Deliver the Twin-Needled Bow Master Move through the ordinary Move gates with focused coverage.
  - Certify multi-target semantics against the existing targeting authority.
  - Evidence: `Triple Threat` is a native Master MoveSpec requiring exactly three selected targets. The ordinary target-count resolver canonicalizes map order, rejects duplicates/count/range/LoS failures, and applies the Twin-Needled Bow 4–12m band to every target. Focused execution proves three attacked targets and mixed `Double Swipe`/`Triple Threat` offer presentation.
- [x] **P11-030 — Certify the weapon-Move cohort** — `DONE`
  - Re-run complete Move coverage and all frozen-successor checks; certify trainer and Pokémon wielder eligibility, rank gates, source-loss withdrawal, and exact retry across all twelve weapon Moves.
  - Certify weapon Moves fail closed in Contest appeal legality and prove zero `definition-missing` Move grant rows remain.
  - Evidence: all 12 supplemental definitions and all equipment Move grants are native; the progress gate advances to 15/29 final rows with zero unregistered debt. Seven new focused executions plus the existing five-Move interaction coverage certify source/rank eligibility, target semantics, withdrawal, and ordinary retry gates. All 12 still fail Contest appeals with `contest.move-identity-missing`; the frozen 777/761/16 artifacts remain unchanged behind two new contiguous successor edges. Seven cohort suites pass 49 tests, generator/source checks pass, and Nuxt typecheck passes.

### Phase 4 — Deferred item actions

- [x] **P11-031 — Freeze the item-action closure matrix** — `DONE`
  - Confirm each of the eleven actions' target final state from the closure inventory — native, guided, or passive — with owning tickets and acceptance mapping; none may target reference-only.
  - Record custody, timing, duration, resource, and privacy requirements per action from the canonical rows.
  - Evidence: `item-action-matrix.v1.json` freezes all 11 exact grant/action identities, canonical item owners, native/guided targets, closure tickets, custody, timing, durations, resources, and private facts. It is bound to the deterministic fixture set and forbids runtime prose parsing/reference-only downgrade. Three matrix tests plus six fixture tests pass.
- [x] **P11-032 — Implement shield ready actions** — `DONE`
  - Implement Light and Heavy Shield readying as native standard actions installing typed duration effects — the canonical Evasion and Damage Reduction bonuses with the Slowed drawback until end of next turn — including the passive equipped bonuses, two-handed variants where canonical, and boundary expiry.
  - Certify stacking, re-ready, source-loss, and round-boundary semantics with focused coverage.
  - Evidence: both exact equipped shield grants are native private-command-backed Standard Actions. The shared replay-safe equipment-action commit path stores immutable command/result/evidence rows, authorizes current offers and exact whole-item revisions server-side, spends encounter economy, commits map/sheet CAS writes, and publishes persisted realtime events. Light Shield retains passive +2 Evasion and readies for an additional +2 Evasion/+10 DR; Heavy retains passive +2 and readies for +4/+15; both apply Slowed through end of the actor's next turn. Re-ready replaces rather than stacks, source loss reconciles opaque source-bound effects, the ordinary lifecycle expires them at the second actor turn-end, and two-hand custody projects a Small Melee attack source. Generator drift, Nuxt typecheck, and 10 focused engine/use-case tests pass.
- [x] **P11-033 — Implement Shock Collar activation** — `DONE`
  - Implement remote activation as a native action: exact one-sixth max Hit Point loss on the wearer through authoritative HP mutation with receipts, worn-collar and remote custody validation, and the reviewed Ground-type variant policy.
  - Certify the Press Feature interaction and role-safe consent and visibility semantics.
  - Evidence: Shock Collar is a native Standard Action with one server-derived paired-wearer choice. Ordinary trainer-origin collar custody now models the bundled remote without requiring an invented second purchase; explicit split remote/collar pair state is also supported. Declaration privately binds opaque remote and exact collar instance revisions, execution revalidates both, deducts `max(1, floor(real Max HP / 6))` through authoritative sheet HP mutation, wakes Sleep under active-HP-loss rules, and journals HP/Press-trigger receipts. Ground wearers fail closed unless the exact collar state records the Ground-capable variant. Player execution requires control of both operator and wearer; public projections expose neither component identity nor pair key. Generator drift, Nuxt typecheck, and 21 focused item-action/grant tests pass, including ordinary custody, explicit pairing, stale source, Ground policy, Press fact, replay-safe commit, and privacy.
- [x] **P11-034 — Implement the Glue Cannon attack** — `DONE`
  - Implement the AC 8 status attack through the existing status-attack pipeline: charge consumption, hit → Slowed, and the canonical critical-hit escalation, with receipts and history.
  - Certify no-charge, out-of-range, and duplicate-delivery behavior.
  - Evidence: Glue Cannon is a native exact two-hand Standard Action with server-projected remaining charges and participant choices. Its status attack reuses authoritative token distance, 4m range, LoS/rough cover, actor Accuracy, target Speed Evasion/Ability modifiers, natural auto-hit/miss, and critical rules. Every attempted shot atomically consumes one of the canonical three bundled packets; a normal hit installs typed Scene Slowed, natural 20 installs Stuck+Trapped instead (respecting condition immunity), and a miss installs none. Zero charge, >4m, and blocked LoS fail before RNG/economy/state changes. Receipt history records declaration, packet spend, accuracy, condition, and acceptance; exact duplicate delivery returns the original roll with one packet spend and one revision. Generator drift, Nuxt typecheck, and 27 focused cohort tests pass.
- [x] **P11-035 — Implement the Hand Net attack** — `DONE`
  - Implement the AC 6 status attack netting a Small Pokémon: trapped state, move-with-target semantics, and escape/release paths through existing condition authority.
  - Certify size legality and stale-target validation codes.
  - Evidence: Hand Net is a native exact two-hand AC 6 melee Status Action whose offer lists only server-derived Small Pokémon candidates. Execution validates Pokémon identity, current effective size, 1m footprint distance, LoS/cover, actor Accuracy, target Speed Evasion, and immunity before installing source-bound typed `netted` capability plus Trapped effects with trigger/dispel release metadata. Same-net re-use replaces rather than stacks; misses install nothing. Authoritative movement treats the restrained Pokémon as the wielder's linked companion, and capture breakdowns consume the active typed marker for the canonical −20 roll modifier. Medium, stale, non-Pokémon, out-of-range, and blocked declarations fail before RNG/economy. Generator drift, Nuxt typecheck, and 33 focused item-action/cohort tests pass.
- [x] **P11-036 — Implement Weighted Nets throw and pull** — `DONE`
  - Implement the thrown AC 8 status attack installing the netted state and the separate standard-action pull moving the netted Pokémon one meter toward the wielder through map authority.
  - Certify throw/pull sequencing, escape, and both actions' exact retry.
  - Evidence: both exact two-hand Weighted Net grants are native. Throw is an AC 8, 0–4m LoS Status Action using ordinary Accuracy/Evasion authority; a hit installs source-bound typed netted + Slowed effects, suppresses effective `movement.sky`/`movement.levitate`, and supplies the −20 capture marker. One physical source cannot redeploy while active. Pull appears only for the same source's current target and uses authoritative full-distance forced displacement to move it exactly one meter toward the wielder, failing on collision. Pull-before-throw, wrong source, out-of-range, blocked movement, redeployment, and miss paths are certified. SQLite acceptance proves both throw and pull exact retries preserve one roll/spend/revision and one meter. Generator drift, Nuxt typecheck, and 39 focused cohort tests pass.
- [x] **P11-037 — Complete the netted and trapped condition family** — `DONE`
  - Unify the Hand Net and Weighted Nets restraint states into one reviewed typed condition family with escape, release, source-loss, and cleanup semantics integrated with existing condition and movement authority.
  - Certify projections and history for restrained participants across roles.
  - Evidence: Hand and Weighted Net effects now share exact-source `equipment.restraint.netted` authority, family tags, typed conditions, −20 capture authority, and all-or-none reconciliation. Source unequip/release, inactivity/breakage after authoritative durability damage, source placement loss, target removal, or partial condition clearing removes the entire linked family rather than leaving orphan movement, capture, or suppression state. Hand Net retains linked wielder movement and Trapped; Weighted Nets retain Slowed plus effective Sky/Levitate suppression until unified release. Public role-safe passive summaries expose the restrained participant and applicable facts without exact item IDs, while persisted equipment-action receipts and equipment-operation breakage evidence remain authoritative history. Nuxt typecheck and 28 focused net/source-loss interaction tests pass; the deferred-closure checker remains green (22/29 final, seven registered debts).
- [x] **P11-038 — Implement the fishing action contract** — `DONE`
  - Implement rod fishing declarations: two-handed custody, water-adjacency eligibility policy, campaign-time cost, and the Skill Check integration point, reusing the exploration-item GM-prompt anatomy.
  - Certify declaration legality, cancellation, and reconnect behavior.
  - Evidence: Old, Good, and Super Rod grants now dispatch through the authoritative equipment-action path from exact active two-hand custody. Offers are available only beside a server-classified water voxel and require one adjacent spatial cell; execution revalidates map bounds, terrain tags, footprint distance, current rod identity/revision, and campaign-clock checkpoint without trusting browser geometry or rolling early. An accepted declaration atomically creates a private source-bound `fishing-adjudication` request with a deterministic generic-check integration identity and exact 15-minute ready boundary while returning only safe receipts and role projections. The existing guided-request queue provides GM/owner reconnect and actor cancellation, including cancellation after source loss; exact retries do not duplicate requests or revisions, duplicate active attempts roll back the map CAS, and realtime payloads omit exact source/check identities. Schema 48 row-preservingly admits the request kind atop schema 47 equipment actions. Generator/checker drift, Nuxt typecheck, 52 migration tests, and a 90-test focused closure cohort pass.
- [x] **P11-039 — Implement fishing resolution as a guided outcome** — `DONE`
  - Resolve fishing through a bounded guided GM adjudication honoring rod-tier constraints (Old Rod: small unevolved level ≤ 10; Good and Super Rod: GM discretion within their canonical bounds), producing durable receipts and campaign attention items; what is hooked remains ordinary GM authority until Plan 12 tooling exists.
  - Certify that no fishing surface remains deferred and record the reviewed Plan 12 handoff boundary in the closure inventory.
  - Evidence: the strict `resolve-fishing` terminal command binds the declaration's private Skill Check integration identity, one canonical skill, a no-hook result or one exact canonical Pokédex species and Level 1–100, and a private bounded GM note. Settlement is GM-only and revalidates the 15-minute campaign boundary, exact active two-hand rod custody/revision, current actor placement, selected authoritative water cell, and reviewed grant hash. Old Rod enforces Small + unevolved + Level ≤10, Good Rod enforces unevolved, and Super Rod remains stage/size unrestricted; all tiers fail closed on unknown species or stale integration authority. Accepted/no-hook results clear durable campaign attention, store hash-bound private terminal evidence, emit role-safe realtime summaries, and replay without a second settlement; injected post-write failure rolls back cleanly. All three closure-inventory rows are now `guided`, and the recorded Plan 12 boundary excludes campaign encounter tables, biome selection, and automatic hook spawning while leaving those content choices to the GM. Generator/checker drift, Nuxt typecheck, and a 70-test focused cohort pass.
- [x] **P11-040 — Implement Snag Machine conversion** — `DONE`
  - Implement the portable and large variants with exact custody, Poké Ball → Snag Ball conversion through existing inventory transactions, and capture-authority integration for throws against owned Pokémon behind a bounded guided GM legality decision.
  - Certify conversion receipts, idempotency, and role-safe visibility of the act.
  - Evidence: exact Portable Accessory custody now spends one Swift Action, becomes ready after one round, and expires after that one-round window; exact Large inventory machines permanently convert at most five unreserved canonical Poké Ball units per campaign day. Both variants create private, durable, GM-only approve/deny requests and preserve every original Ball property. Approved conversions are exact-row reservations with bounded history; throws apply the reviewed −2 attack-roll penalty, consume one conversion and one Ball atomically, and may transfer one unambiguously owned Pokémon between exact Trainer rosters under complete-directory CAS authority. Public offers, requests, logs, and realtime events expose only opaque source choices and safe Snag Ball outcomes, while exact machine/Ball identities and GM notes remain private. Schema v49 row-preservingly admits conversion requests; rollback, denial, stale custody/round/day, expiration, exact retry, owned-target capture, and replay are certified. Generator/checker drift, Nuxt typecheck, 131 focused mechanics/storage/projection tests, and 17 source-chain/inventory tests pass.
- [x] **P11-041 — Complete item-action presentation and accessibility** — `DONE`
  - Retire all eleven deferred presentation reasons across the Action Dock, inventory, and sheet surfaces with role-correct offers and unavailable reasons only where mechanics legitimately forbid action.
  - Pass keyboard, touch, screen-reader, zoom, and reduced-motion checks on the changed surfaces.
  - Evidence: all eleven reviewed actions now share canonical public labels, timing, target, and outcome copy across equipped Trainer/Pokémon sheets, inventory guidance, Action Dock cards, contextual affordances, guided waiting states, focused declaration receipts, durable accepted history, and the GM guided workshop. Offers expose server-derived legal targets or explicit range, LoS, size, charge, deployed-source, water, pairing, Poké Ball, action-economy, and custody reasons; exact item identities, request/check identities, hook evidence, and GM notes stay outside public projections. Map-scoped equipment and fishing/Snag histories are bounded and adapted into status-only pending or role-safe terminal presentations, while equipment/guided receipts are excluded from the ordinary item-correction control. Keyboard shortcuts, focus entry/restoration and error focus, 44px touch controls, semantic status/alert copy, narrow-screen reflow, and reduced-motion-safe presentation are covered by the accepted target-state mockup and focused component/accessibility suites. Nuxt typecheck, ESLint, the encounter design checker, the complete-loop accessibility/visual gate (34 tests), 94 focused accessibility/component tests, 103 item-action mechanics/projection tests, 56 storage/migration tests, generator drift, deferred-closure registration, and contiguous P11-041 successor checks pass under bounded workers.
- [x] **P11-042 — Rebuild item registries after review** — `DONE`
  - Regenerate the grants, contributions, and cohort registries so every audited item action carries its final state, with drift gates and no unintentional changes to unrelated rows.
  - Re-run the affected generated-data checks and frozen-successor validations.
  - Evidence: the regenerated grants registry now distinguishes native declaration-executor readiness from reviewed finality, binds that finality to the frozen item-action matrix, and records every audited action as exactly `native` or `guided` with null stale tickets. Contributions bind the exact grants hash and per-grant final states while preserving unrelated passive/deferred contribution facts; cohorts bind the same grants authority and expose strict member-level action final states without changing their established item-level passive/mixed classification. Strict shared parsers and server registries reject deferred/unknown action states, duplicate action identities, hash drift, and cross-registry disagreement. The dependent Re-Breather guided contract was source-successor-rebound and regenerated without changing its bounded mechanics. Accepted contiguous successors preserve every touched frozen Plan 8/11 certification. All four affected generator checks, Python compilation, the closure checker (`26/29` final with three registered future debts), Nuxt typecheck, targeted ESLint, 77 focused data/certification tests, and 41 focused registry/runtime tests pass under bounded workers.
- [x] **P11-043 — Certify item-action recovery and concurrency** — `DONE`
  - Certify exact retry, duplicate delivery, reconnect, restart, stale-revision conflict, and rollback behavior for all eleven actions with the Phase 1 fixtures.
  - Include cross-client realtime convergence for durable states like readied shields and netted targets.
  - Evidence: `item-action-recovery-certification.v1.json` binds all eleven frozen matrix rows to every Phase 1 stale, duplicate, reconnect, restart, and interrupted-commit scenario and to exact hashes for the shared transaction, operation ledger, guided settlement, realtime authority, and passing action tests. Duplicate declarations now return the original result for both shields, Glue Cannon, Hand Net, both Weighted Nets operations, all three rods, both Snag variants, and Shock Collar without another roll, spend, request, movement, HP loss, revision, or event. Deterministic failure hooks certify complete rollback after map, sheet, guided-request, operation-ledger, and realtime writes; stale authority writes nothing, while native accepted operations and guided pending requests recover from real SQLite close/reopen cycles. Complete client-attributed map events converge both readied shields plus Hand/Weighted Net restraints and pull movement to another client/reconnect, and exact replay emits no duplicate event. The completion rubric now marks the item-action runtime certificate passing. Nuxt typecheck, targeted ESLint, the closure checker (`26/29` final), and 88 bounded recovery, mechanics, fixture, rubric, and certification tests pass.
- [x] **P11-044 — Prove zero deferred core item actions** — `DONE`
  - Extend the rubric checker to fail on any remaining deferred, definition-missing, or deferral-flavored item-action row across the audited registries.
  - Record the item-action closure evidence in the closure inventory.
  - Evidence: `item-action-closure-proof.v1.json` records exactly eleven final rows — seven native and four guided — with zero deferred, contradictory, missing, stale-ticket, unresolved, uncovered-recovery, or runtime-prose rows and exact bindings to the matrix, grants, contributions, cohorts, recovery certificate, inventory, rubric, and checker. The checker now independently cross-validates executor readiness and reviewed finality, null action pointers, contribution final-state uniqueness and empty deferred mechanics, cohort member finality and empty unresolved requirements, exact inventory state/evidence, recovery finality, proof counts, and all authority hashes on every progress run. Synthetic mutations certify fail-closed behavior for deferred/final-state drift, `definition-missing`, stale tickets, absent grants, contribution debt, cohort contradiction/debt, stale inventory, recovery contradiction, and dishonest proof counts. All eleven inventory rows now carry their exact final state and `p11-044.item-actions` evidence with stale Plan 8 fields removed; the rubric marks runtime and zero-debt item evidence passing and reads all reconciled registries. All three registry drift checks, Python compilation, targeted ESLint, the checker (`11` item actions: `7` native, `4` guided, `0` deferred), and 67 bounded deferred-closure data tests pass.

### Phase 5 — Generic liveplay Skill Checks

- [x] **P11-045 — Implement the SkillCheckDocument and storage migration** — `DONE`
  - Add the versioned check document, schema migration, and repository plumbing: requester, subjects, skill identities, DC or opposed policy, state machine, journals, and settlement references.
  - Reject unknown schema versions and certify fresh-database and upgrade paths.
  - Evidence: the reviewed v1 contract now has strict persistence parsers for complete documents and all six bounded commands, rejecting unknown/missing fields, unsupported schema versions, noncanonical skills, invalid DC/opposed shapes, forged dice fields, malformed identities, and inconsistent journal/result/terminal state. Schema v50 adds indexed Skill Check documents and replay-safe operation journals with bounded JSON, exact state/mode constraints, deferred foreign-key integrity, and terminal checks. The SQLite repository enforces revision-one creation, plus-one CAS replacement, immutable requester/creation authority, exact row/document identity, bounded state/requester queries, canonical command hashes, principal-bound operation replay, operation conflicts, and corruption refusal. Fresh creation, exact v49→v50 row-preserving upgrade, all historical migration paths, file close/reopen, future-schema refusal, persisted schema-v2 rejection, and operation replay are certified. The storage-version breeding documentation and generated item-cohort source evidence were successor-refreshed without changing cohort members. Nuxt typecheck, targeted ESLint, all affected generator/documentation checks, 63 migration/storage/documentation tests, 56 contract/cohort/proof tests, source-chain checks, and the closure checker pass under bounded workers.
- [x] **P11-046 — Implement server check authority** — `DONE`
  - Resolve skills and modifiers from authoritative sheets, roll journaled dice server-side, apply DC and opposed comparisons, and commit accepted results with revisions and idempotency.
  - Forbid client-supplied rolls and certify exact retry returns the original result.
  - Evidence: `resolveCheck.ts` now resolves Trainer and Pokémon skill pools only from exact current sheet revisions, includes reviewed Edge calculations and active equipment-contribution providers, separates GM-only situational modifiers, and fails closed on stale/missing sheets, malformed or out-of-bounds skills/modifiers, expiry, and invalid entropy before any accepted write. DC groups settle per subject; opposed checks journal both sides through the initial attempt and ten bounded tie rerolls, then encode the reviewed fair server coin as one reserved d6-parity journal without adding a second dice authority. Strict accepted-document invariants verify contributor arithmetic, journal order, final totals, DC outcomes, opposed winners, and tie evidence. `resolveSkillCheckUseCase` accepts only the roll-free resolve command, binds operation ID + canonical command hash + principal, commits the accepted revision and durable operation in one SQLite transaction, and returns original journals/results on exact retry without reading time or entropy. `skill-check-authority-certification.v1.json` binds all authority and 13 positive/failure scenarios by SHA-256. Nuxt typecheck, targeted ESLint, 55 affected skill/equipment/derived tests, 31 closure-ledger/proof tests, source-successor checks, generated cohort drift check, `git diff --check`, and the closure checker pass under bounded workers.
- [x] **P11-047 — Implement the GM check workflow** — `DONE`
  - Let the GM request single and group checks against trainers and Pokémon, set DCs from reviewed presets or explicit values, observe pending responses, and resolve or cancel with receipts.
  - Keep GM intent private until results are accepted where the reviewed contract requires it.
  - Evidence: a source-hash-bound reviewed registry now supplies Easy 5, Challenging 10, Hard 15, and Nigh-impossible 25 workflow aliases while preserving explicit DC 1–100 and concrete-DC-only persistence. Strict request and GM-response parsers reject old/unknown shapes, forged presets, extra authority, malformed receipts, and private dice fields. The GM-only GET/POST route family and atomic workflow bind exact current Trainer/Pokémon sheet revisions, profile/team-derived controllers, preset or explicit DCs, opposed subject counts, private cancellation reasons, principal-bound operation hashes, CAS revisions, server-dice resolution, and exact replay; injected document/operation failures roll back completely. The Director Checks tab observes pending/ready requests, authors canonical subject/skill pairs, resolves or cancels with accessible receipts, and preserves an uncertain command for exact retry without any roll input. `skill-check-gm-workflow-certification.v1.json` SHA-binds the complete authority and 21 lifecycle/privacy/presentation scenarios. The selected target mockup (`.pi/artifacts/ui-mockups/gm-skill-check-director/v001.png`) passed autonomous review at 9/10. Nuxt typecheck, targeted ESLint, encounter design checks, preset generator drift/Python compilation, 84 focused workflow/contract/closure tests plus 19 focused accessibility/design tests, `git diff --check`, and the closure checker (`26/29` final with three registered activation debts) pass.
- [x] **P11-048 — Implement the subject check workflow** — `DONE`
  - Prompt check subjects with role-correct requests, skill and modifier transparency, and accepted-result presentation consistent with existing decision surfaces.
  - Certify prompted, declined-where-legal, and timed-out paths with durable evidence.
  - Evidence: strict subject-only request/receipt contracts and a dedicated projection builder now expose only the controlled Trainer or Pokémon, canonical skill pool, subject-visible contributor arithmetic, private-GM-adjustment presence without its value, concealed-or-authorized DC state, aggregate readiness, current response authority, and the subject's own visible-or-explicitly-withheld terminal result. The atomic subject workflow authorizes stored controllers or GM NPC authority, revalidates exact sheet/provider skill authority, advances all-accepted groups to ready, journals legal declines durably, binds CAS + principal + canonical command hashes, returns exact replay without rereading time, and atomically rolls back document/operation failures. An authority-free authenticated trigger creates deterministic server-owned timeout commands tied to campaign-minute audit evidence; declined/pending/ready expiries settle durably without client time authority. Strict role-specific routes reject profile spoofing, extra fields, forged dice, unbounded queries, and client-authored timeout commands. The Live Encounter subject Decision Layer never competes with an existing tactical decision, supports exact uncertain-response retry, and presents prompt/waiting/declined/timed-out/visible-result/withheld-result/stale/reconnect states with no roll input. `skill-check-subject-workflow-certification.v1.json` SHA-binds 26 lifecycle, privacy, role, rollback, route, and presentation scenarios; contiguous successors preserve the frozen P8 Finish Encounter UI authority. The selected subject mockup passed at 9/10. Nuxt typecheck, targeted ESLint, 85 focused authority/workflow/storage/component tests, 57 certification/closure/accessibility tests, encounter-design validation, `git diff --check`, and the closure checker (`26/29` final with three registered activation debts) pass.
- [x] **P11-049 — Implement check projections and privacy** — `DONE`
  - Produce structurally distinct GM, subject, and spectator projections for pending and accepted checks and their history.
  - Certify no private modifier, note, or diagnostic leaks through any projection.
  - Evidence: strict role-projection contracts and server builders now expose three structurally disjoint envelopes: the GM receives the full validated document plus exact authoritative modifier contributors; each controlled subject receives only its own prompt, canonical pool, visible contributors, aggregate readiness, own result, and opaque generic history; spectators receive only the public label, pending count, generic non-response history, and an accepted aggregate or explicit withheld state. Subject corrections are visible only to the corrected subject, private corrections are omitted from public history, and exact parsers bind chronological history and terminal states while rejecting cross-role fields. The authenticated bounded projection route selects GM, resolved-profile subject, or spectator authority without accepting GM profile spoofing. A compact non-GM Live Encounter event-feed surface presents waiting, aggregate, withheld, cancelled, timed-out, and history states; the selected target mockup passed autonomous review at 9/10. `skill-check-projection-certification.v1.json` SHA-binds ten authority surfaces and 13 projection, no-leak, route, presentation, and mockup scenarios. Nuxt typecheck, targeted ESLint, encounter-design validation, 68 focused Skill Check tests, 48 closure/certification tests, `git diff --check`, and the closure checker (`26/29` final with three registered activation debts) pass.
- [x] **P11-050 — Integrate checks with consuming flows** — `DONE`
  - Route the fishing skill check and any closure-inventory rows that require generic checks through the new surface where the reviewed contract authorizes it, without breaking existing bespoke adjudications.
  - Record which flows intentionally keep their existing check machinery and why.
  - Evidence: all three rod requests now settle only with one accepted generic single-subject DC Skill Check created no earlier than the guided declaration and bound server-side to the exact fishing actor kind/slug, canonical Skill, immutable accepted result, and one-use link. The private synthetic declaration nonce, 15-minute campaign boundary, exact active two-hand custody, water geometry, canonical rod hook bounds, hook/Level, and GM note remain independently revalidated in the original atomic guided settlement; missing, unavailable, pending, mismatched-Skill, predating, and reused checks write nothing. The GM fishing decision loads only full-GM accepted-check projections, filters matching actor checks, disables hook controls until linked, and accepts no manual ID, roll, total, or modifier. Owner/public guided projections retain no check ID, exact actor slug, total/outcome, hook, or note. The source-bound consuming-flow policy records fishing as the only closure-inventory generic-check consumer and intentionally retains First Aid Kit healing, Move checks, Contest dice, breeding ledgers, and route-lure/Dowsing rolls in their atomic or document-specific authorities. Legacy accepted fishing commands reopen with their original hashes while every new settlement requires the generic link. `skill-check-consuming-flow-certification.v1.json` binds six authorities and 18 integration, rejection, privacy, retry, rollback, retained-flow, and presentation scenarios; the selected target mockup passed autonomous review at 9/10. Nuxt typecheck, targeted ESLint, 33 focused fishing/guided tests, 53 cohort/closure/certification tests, all affected generator drift checks, and the closure checker pass.
- [x] **P11-051 — Complete check accessibility and liveplay acceptance** — `DONE`
  - Pass keyboard, touch, screen-reader, zoom, reflow, and reduced-motion checks and desktop/mobile liveplay journeys for request, response, and history surfaces.
  - Meet the existing decision-surface performance budgets.
  - Evidence: GM, subject, spectator, and fishing-consumer surfaces now carry explicit names/descriptions, busy/status/error semantics, 44px high-contrast controls, reduced-motion behavior, narrow reflow, and deterministic focus entry/return after request, response, cancellation, terminal dismissal, and refresh. Initial DOM work is bounded to 20 GM requests, 20 subject-history rows, and 20 spectator checks with at most four history rows each; later batches require explicit activation and focused fixture presentation/expansion remain within the existing 250ms/100ms budgets. A production-build Playwright journey passed package-pinned desktop and Pixel 7 Chromium for keyboard-only GM request → subject response → GM resolution → spectator history, serious/critical WCAG findings (zero), touch targets, role privacy, reduced motion, table-distance mode, and 320 CSS-pixel no-overflow reflow. `skill-check-accessibility-certification.v1.json` SHA-binds the frozen budgets, four surfaces, Live Encounter integration, 27 component/browser/mockup scenarios, and both browser projects. Nuxt typecheck, targeted ESLint, 21 component tests, 52 closure/certification tests, the official two-project production Playwright run, `git diff --check`, JSON validation, and the closure checker pass.
- [x] **P11-052 — Certify check recovery, concurrency, and history** — `DONE`
  - Certify reconnect, restart, duplicate delivery, stale revisions, and rollback for single and group checks.
  - Certify campaign history and attention integration for unresolved checks.
  - Evidence: the final Skill Check recovery certificate now binds the existing synchronous SQLite transaction, CAS document repository, principal/command-hash operation journal, GM/subject/resolve workflows, and a new aggregate runtime suite. Single checks survive a real file-backed SQLite close/reopen and reconnect with exact receipts, original journals/results, zero rerolls, zero duplicate operations, and zero duplicate attention invalidations; group clients serialize through shared revision CAS, reject stale concurrent responses without writes, reload current authority, and converge. Request, response, resolution, cancellation, and timeout evidence remain atomic at both injected document and operation boundaries, while transient post-commit invalidation failure cannot reject or alter an accepted command. Campaign attention now reads all current Skill Checks in the same complete bounded transaction, creates exact-controller owner response work plus informational or urgent GM review, redacts Profile entities from owner output, and removes terminal checks. A strict twenty-row campaign-history route projects only public labels, terminal lifecycle/time, and an owner's own outcome, mixed result, or explicit withholding; GM outcomes stay generic, unrelated checks and all notes/modifiers/subjects/dice/totals/revisions/operations remain absent. The secondary matte campaign card initially renders four rows, expands explicitly, retains focus and the last complete projection across malformed refreshes, reflows at narrow widths, and returns to Live Encounter; its reviewed target mockup passed at 9/10. `skill-check-recovery-certification.v1.json` SHA-binds 13 authority/documentation surfaces and 33 recovery, attention, history, route, component, and mockup scenarios. The closure inventory now marks the generic Skill Check runtime native and the checker reports `27/29` final with only the two registered Contest variant activation debts. Nuxt typecheck, targeted ESLint, JSON validation, `git diff --check`, the closure checker, and 264 bounded Skill Check/campaign/closure/regression tests across 49 files pass.

### Phase 6 — Trainer Participant Contests

- [x] **P11-053 — Extend the ContestDocument to trainer performers** — `DONE`
  - Extend enrollment, contestant identity, and controller semantics so trainers enroll as performers beside their Pokémon without parallel sheet or dice authority.
  - Reject trainer enrollment in variants whose canonical rows do not permit it.
  - Evidence: `ContestDocumentV1` now layers the source-bound `trainer-participant` format over the unchanged canonical base variants and persists strictly discriminated Trainer/Pokémon performer snapshots. Each paired entry binds exactly one Trainer performer to the contestant's existing Trainer slug and revision, retains the base variant's exact Pokémon cardinality, keeps Rotation order Pokémon-only, and keeps every Trainer compatibility dice pool empty so P11-054 can share the Pokémon authority by reference. Enrollment resolves the existing Trainer and Pokémon repositories, authoritative Trainer movelist, current selected-profile links or GM controller, and exact revisions; missing sheets/profiles/control, duplicate identities, cross-kind fields, unknown participant formats, or incompatible canonical bases write nothing. Canonical Trainer Moves are available while unknown, created, and weapon Moves remain explicitly unavailable. Exact operation retry cannot duplicate enrollment and succeeds from the frozen accepted snapshot without a second sheet read. Legacy schema-v1 Pokémon-only documents normalize additively to `participantVariantId: null` and `performerKind: pokemon` before exact parsing. Public projections expose only the format label and ordinary Pokémon scoreboard name, while GM/owner projections retain their existing paired authority shapes. Trainer Participant progression deliberately remains setup-only with a no-write `contest.trainer-participant-stage-unavailable` gate pending P11-055 through P11-064. `trainer-participant-document-certification.v1.json`, its operator contract, two focused authority suites, the refreshed deterministic ordinary-variant fixture source hash, and four accepted frozen-surface successors bind the result. Nuxt typecheck, targeted ESLint, the Contest generator drift check, closure/JSON/diff validation, and the bounded Contest regression and certification suites pass.
- [x] **P11-054 — Implement the shared contest dice-pool policy** — `DONE`
  - Implement the canonical shared Trainer-plus-Pokémon Contest Stat Dice pool, including Coordinator-style Feature spend on either performer where canonical.
  - Certify single-spend accounting across the pair with journaled evidence.
  - Evidence: the exact source-bound `trainer-pokemon-entry` policy is now validated at catalog load and implemented without a second dice authority: every Pokémon retains its one server-derived preparation pool, the paired Trainer retains exact empty compatibility pools, and either active member spends the same pool by reference. Combat-stat, Poffin, Style Expert, temporary-reallocation, Ability, and item provenance therefore stay in the existing preparation authority; current-sheet source loss deactivates a lost Feature once while preserving accepted spend. Rotation entries keep each Pokémon pool plus the base variant's shared Introduction pool and deplete the team pool first, preserving the existing Rotation policy and cap. Every nonzero paired spend produces one operation-derived immutable receipt with the acting performer, exact paired Pokémon, full per-stat spend, separate Pokémon/team allocation, and both sources' before/after vectors. Exact retry cannot deplete twice; changed input, wrong pair, duplicate or orphan evidence, overspend, forged allocation, copied Trainer pools, and corrupt persisted rows fail closed. Accepted P11-053 setup documents normalize only the scope marker and empty journal without moving pools, while lifecycle progression remains gated until P11-055 onward. `trainer-participant-shared-dice-certification.v1.json`, two focused shared/runtime suites, the updated operator contract, and five contiguous successor edges bind the result. Nuxt typecheck, targeted ESLint, deterministic Contest fixture drift, closure registration, source-chain certification, and bounded Contest regression suites pass.
- [x] **P11-055 — Implement the canonical method policies** — `DONE`
  - Implement the reviewed method options from the successor variant row — simultaneous appeals with player-chosen order and separate voltage, and alternating appeals with shared voltage — as explicit per-contest policy choices.
  - Fail closed on any method semantics the canonical row does not define.
  - Evidence: Trainer Participant documents now carry one explicit public `participantMethodId`; new create commands require `simultaneous` or `alternating`, while accepted P11-053/P11-054 setup documents normalize to `null` and must use the GM-only, setup-only, CAS/replay-safe `set-participant-method` command. The catalog loader validates exact method cardinality, field sets, appeal counts, order, Voltage, adjacency, and cross-performer policies. A source-bound scheduler gives Simultaneous entries two appeals per round with either controller-chosen first member and the exact partner second; Alternating entries get one appeal per round, permit either member only when no predecessor exists, and thereafter require the opposite member. Duplicate members, overfilled rounds, broken alternation, unknown methods, ordinary-Contest method authority, changed-input retry, stale revisions, and non-GM writes fail closed. Voltage/adjacency scopes are returned as typed later-ticket authority rather than prematurely mutating scores. Public/owner/GM projections expose only the format choice, and the existing setup Workshop adds a labelled, responsive 44px button fieldset, public header label, and text-backed missing-choice lock; this exact mechanical extension reused existing design primitives, so mockup generation added no material information. Missing-method and post-selection progression gates write nothing pending P11-056. `trainer-participant-method-certification.v1.json`, two focused method suites, the operator contract, and ten contiguous P11-055 successor edges bind the result. Nuxt typecheck, targeted ESLint, migration/generator drift, closure/JSON/diff checks, and 116 bounded Contest tests across 22 files pass.
- [x] **P11-056 — Implement the trainer introduction stage** — `DONE`
  - Run trainer introductions through the existing introduction authority with canonical skills, journaled rolls, and letter assignment for trainer performers.
  - Certify parity with Pokémon introductions in projections and history.
  - Evidence: Trainer Participant entries now enter the base Introduction stage after an explicit method and complete lineup. Each entry still receives one Introduction—not parallel rolls—but `ContestIntroductionStateV1.performerId` binds it to the exact enrolled Trainer performer and the existing enrollment-time Charm, Command, Guile, Intimidate, or Intuition dice. The unchanged server dice authority journals base/bonus rolls and tie entropy, derives generated Contest Stat dice, matching bonuses, letters, public accepted history, and owner-only evidence. Non-Rotation contributions write only to the paired Pokémon pool shared by reference; Rotation contributions write only to the existing team Introduction pool; Trainer pools remain empty. Exact legacy reads backfill the Trainer actor without inventing rolls, while forged actors fail closed. All three-to-five entries receive deterministic unique letters through the ordinary authority; public views retain only stage, letters, and generic history, GM/owner views retain authorized exact evidence, and one owner cannot see another entry's private roll evidence. Restart removes only generated contributions, preserves the exact Trainer actor and immutable superseded journals, and resets letters. Exact retry adds zero rolls/revisions/operations/contributions/history; changed input and stale revision write and roll nothing. Performance remains quarantined at `start-performance` for P11-057. `trainer-participant-introduction-certification.v1.json`, two focused introduction suites, the updated operator contract, and six contiguous P11-056 successor edges bind the result. Nuxt typecheck, targeted ESLint, migration/generator drift, closure/JSON/diff checks, and 124 bounded Contest tests across 25 files pass.
- [x] **P11-057 — Implement trainer appeals** — `DONE`
  - Let trainers declare appeals from their real Move lists with canonical contest-type matching and effects; Moves without canonical contest identity — including weapon Moves — fail closed with explicit reasons.
  - Certify appeal, fumble, and scoring parity through the existing performance authority.
  - Evidence: Alternating Trainer Participant contests now enter Performance and bind every entry turn through the reviewed scheduler: either member may lead, then the exact opposite Trainer/Pokémon kind is required on each later chart turn and across Festival heats. Trainer offers come from the frozen enrolled Trainer movelist and canonical app-owned Move identities; unknown/created Moves without an explicit identity fail with `contest.move-identity-missing`, while all twelve source-bound weapon Moves remain visible but unavailable under `weapon-move-no-canonical-contest-identity` rather than borrowing Pokémon semantics. Accepted Trainer appeals reuse the ordinary matching/opposition, center chart, base/Voltage/type/effect assembly, server d6 journal, Appeal/Fumble scoring, consequence, repetition, history, CAS, and realtime authority. Strict persistence now binds the exact available performer option, label, type, effect, journal, score, consequences, and alternating sequence. A Trainer spends from its exact paired Pokémon pool by reference; Rotation binds the round-locked Pokémon and consumes the separate team Introduction pool first. Get Ready is derived from the same performer's previous appeal so the intervening partner cannot consume its multiplier. Snapshotted profile control, exact retry, forged-sequence/option refusal, ordinary final-score/placement parity, and pre-reward no-write behavior are covered. Owner projections add legal performer IDs while retaining singular compatibility only when unambiguous. Simultaneous performance remains fail-closed for P11-058, participant interventions for P11-059, and reward preparation for P11-061. `trainer-participant-appeal-certification.v1.json`, five focused runtime scenarios, the updated operator contract, and seven contiguous P11-057 successor edges bind the result. Nuxt typecheck, targeted ESLint, migration/generator drift, closure/JSON/diff checks, and 131 bounded Contest tests across 27 files pass.
- [x] **P11-058 — Implement paired voltage and adjacency semantics** — `DONE`
  - Implement the canonical voltage bookkeeping for both methods and adjacency effects that address both members of a pair.
  - Certify center-of-attention and position chart behavior with paired performers.
  - Evidence: Both reviewed methods now enter Performance. Alternating retains one shared-entry Voltage scalar and one appeal per chart cursor. Simultaneous fixes that scalar at zero, persists an exact all-performer Voltage map, admits either member first, keeps the entry cursor fixed after the first appeal, requires the exact partner second, and advances only after both—eighteen appeals but nine entry positions in a complete three-entry Contest. Every start/end Voltage and nonzero consequence now binds an exact performer and reconciles through history; extra/missing keys, forged targets, overfilled cursors, duplicate member kinds, changed multipliers, and corrupt maps fail closed. Adjacency remains entry-chart authority but fans Voltage effects to the Trainer plus active Pokémon of each adjacent entry; Rotation excludes inactive teammates. Assembly reads both adjacent member values while Appeal/Fumble/center scoring remains entry-level. The two reviewed cross-pair permissions are explicit replay-bound choices: first-member Get Ready can double the same-turn partner once (or remain on its original performer when untargeted), and Attention Grabber can credit the paired member with capped stolen Voltage. Owner action authority exposes both initial performers then only the required partner. The ambiguous legacy shared-entry Voltage correction is refused for Simultaneous with no write. `trainer-participant-voltage-certification.v1.json`, six focused Standard/Rotation/runtime scenarios, the updated operator contract, refreshed deterministic 18-scenario ordinary matrix evidence, and eight contiguous P11-058 successor edges bind the result. Nuxt typecheck, targeted ESLint, migration/generator drift, closure/JSON/diff checks, and 139 bounded Contest tests across 29 files pass.
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
- **2026-08-22 — Equipment-action authority (P11-032).** Deferred item actions extend one private declaration/command/commit family rather than abusing generic inventory-use commands. Public offers retain opaque source references; declaration binds exact whole-item identity and revision; execution reprojects authority, validates custody, owns dice/economy, commits map and sheet CAS writes atomically, and stores replay evidence in schema v47. This seam is shared by P11-033 through P11-040.
