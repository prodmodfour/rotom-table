# Edge Automation Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: done/CAPABILITY_AUTOMATION_PLAN.md — PLAN_STATUS: DONE`

## Goal

Implement complete, server-authoritative automation for every canonical Trainer Edge and Poké Edge used by Rotom Table. This includes passive skill and stat changes, capability changes, move grants, substitutions, crafting and training permissions, capture modifiers, triggered effects, contextual actions, progression choices, and Pokémon-specific edge mechanics.

Trainer Edges and Poké Edges are separate rule families with different owners, acquisition rules, parameters, and effects. They may share a mechanical kernel and generic presentation contract, but they must not be collapsed into one ambiguous free-form sheet list.

This file is the durable implementation ledger for Edge automation. It begins after Capability automation so capability grants and derived values have a stable authoritative owner.

The canonical `Breeder` Trainer Edge crosses into a larger campaign subsystem. This plan owns the Edge's identity, prerequisites, effective permission, contribution evidence, and generic campaign-operation handoff. `BREEDING_AND_EGG_LIFECYCLE_PLAN.md` owns parent compatibility, breeding projects, durable Eggs, offspring resolution, incubation, hatching, child-sheet creation, and related campaign history.

## Canonical scope and baseline

### Trainer Edges

- Current canonical source: `data/reference/edges.json`
- Current Git blob SHA at plan creation: `7e8cfb69115b7f38b40ed477a439261bdbd3f830`
- Current parser: `ptu-data/parse_features_edges.py`
- Current sheet owner: `TrainerSheet.edges`
- Current reference shape contains name, tags, prerequisites, frequency, trigger, target, condition, and effect.
- Existing helpers support reference autofill and a small set of sheet choices such as Basic Skills.

### Poké Edges

- Canonical source material exists in checked-in Pokémon and Trainer source books, but there is no complete, separately frozen app-owned Poké Edge catalog at plan creation.
- Current Pokémon sheet storage is `CharacterSheet.edges`, which is a free-form name/cost/effect list and does not establish canonical identity or mechanics.
- EA-001 through EA-004 must discover, parse, adjudicate, and freeze the complete Poké Edge inventory before implementation.
- Trainer Edge and Poké Edge counts, SHA-256 values, identity policies, source-byte hashes, parser gaps, and aliases must be recorded in the plan before cohort work begins.

### Existing implementation inputs

- Trainer skill derivation, capability derivation, move lists, training features, subchoice metadata, inventory/crafting helpers, capture flows, and combat providers contain partial edge-like behaviour.
- Existing exact-name checks and sheet calculations are migration inputs only.
- Edge automation includes both live encounter behaviour and lasting sheet-derived effects.
- Character-building prerequisite validation is a separate concern from effect execution; GM-authored exceptions must be explicit and must not silently alter canonical mechanics.
- Current Pokémon sheets contain editable egg-group, Egg Move, and inherited-move fields, but those fields are not authoritative evidence of parentage, breeding rolls, inheritance provenance, or a durable Egg lifecycle.

### Breeder cross-plan boundary

- The Edge runtime owns canonical `Breeder` identity, acquisition and prerequisite validation, effective ownership, Pokémon Education contribution evidence, source hashes, and the permission to begin a breeding campaign operation.
- The Edge runtime exposes a typed, source-agnostic campaign-operation handoff. It does not manufacture a child sheet, mutate `eggMoves` or `inheritedMoves` as a substitute for breeding, or store Eggs in Trainer inventory or Pokémon rosters.
- `BREEDING_AND_EGG_LIFECYCLE_PLAN.md` owns compatibility, maturity adjudication, parent snapshots, species resolution, Nature/Ability/Gender choices and rolls, inheritance calculation, project timing, Egg persistence, incubation, hatching, lineage, consent, and first-species ownership rewards.
- The semantic manifest may classify `Breeder` as `delegated-complete` only after the Edge-owned contract is executable, source-hash-bound, covered by tests, and points to the named downstream plan.
- While the downstream subsystem is absent, the generic presentation contract must expose an honest unavailable reason rather than a fake success, prose-only instruction, or browser-authored sheet mutation.
- This is a single reviewed delegation, not a general escape hatch. Any additional downstream delegation requires a decision-log entry and an explicit owning implementation plan.

## Non-negotiable rules

1. **Both Edge families are in scope.** Completing only `data/reference/edges.json` is not full Edge automation.
2. **No runtime prose interpretation.** Canonical text is reviewed into strict specs, providers, grants, choices, or bounded handlers.
3. **Edges are usually not actions.** Passive derivation, substitutions, grants, and trigger subscriptions must not become permanent action buttons.
4. **Canonical identity is separate from sheet choices.** Type, skill, category, move, stat, rank, and other selections use stable instance data.
5. **Build validation and mechanics are separate.** Invalid prerequisites may produce diagnostics or require an explicit GM override, but the runtime never guesses how an edge works.
6. **One effective edge projection.** Base sheet entries, ranked instances, granted edges, temporary effects, suppression, replacement, and source loss resolve deterministically.
7. **Permanent grants are provenance-bound.** Moves, capabilities, abilities, features, skill ranks, and other lasting changes retain their source Edge and reviewed definition hash.
8. **Server authority covers triggered and contextual effects.** Checks, targets, rolls, capture modifiers, maneuver changes, crafting, training, and campaign operations are server-derived.
9. **Cross-character effects validate control.** Trainer-owned Edges affecting linked Pokémon use current roster/profile/map authority rather than browser-selected arbitrary sheets.
10. **Exact retry and atomicity apply.** Multi-sheet, inventory, capture, and campaign mutations commit atomically or through durable sagas.
11. **Privacy remains role-based.** Hidden sheets, build choices, private edges, eligible targets, and GM overrides are projected only to authorised users.
12. **Generic presentation only.** Offers, passives, choices, reasons, explanations, pending responses, and accepted outcomes use the shared automation contract.
13. **Interaction honesty.** Base Edge completion and interactions with Capabilities, Moves, Abilities, Items, Features, and campaign systems are independently certified.
14. **No source omission by convenience.** Out-of-combat, crafting, social, contest, travel, and training Edges require authoritative support or typed adjudication.
15. **Delegation preserves one authority.** A delegated Edge may expose permission and an unavailable handoff, but must never duplicate, pre-empt, or partially persist the downstream subsystem's campaign aggregate.

## Semantic completion contract

An Edge row may be marked `complete` only when all applicable clauses satisfy the following:

- canonical family, identity, tags, prerequisites, ranks, repeatability, choices, owner kind, source provenance, and errata are encoded;
- lasting instance choices are validated and stored as typed data rather than embedded name suffixes or notes;
- acquisition validation reports current eligibility and any explicit GM override without rewriting the canonical prerequisite;
- passive effects contribute automatically to every owning stat, skill, capability, movement, check, capture, maneuver, damage, training, crafting, or other query;
- permanent grants and replacements are applied once, provenance-bound, reversible only under an explicit rule, and safe under retry;
- triggered or activated effects use authoritative events, action/frequency resources, legal targets, server-owned rolls, and exact timing;
- Trainer-to-Pokémon effects validate current ownership, team membership, linked control, and required proximity or scene state;
- campaign operations validate tools, inventory, money, time, environment, and relevant skills;
- all consulted resources join the read set and all writes commit atomically or through an explicit pending saga;
- source loss, retraining, rank changes, evolution, trade, recall, faint, scene, day, and rest lifecycle behaviour is tested where applicable;
- executable scenarios cover every branch, cap, substitution, failure, no-op, trigger, choice, and interaction required by the Edge’s own text;
- the semantic manifest has reviewed runtime/hash/source evidence and no hidden manual mechanic;
- public, owner, GM, and diagnostic presentation uses the shared generic contract.

A row may be marked `delegated-complete` only when all Edge-owned clauses above are complete and the manifest additionally records:

- the exact downstream plan and subsystem capability identifier;
- the source-hash-bound request, permission, contribution, privacy, and unavailable-reason contracts;
- tests proving no downstream state is inferred, duplicated, or browser-authored;
- a release checker that distinguishes reviewed delegation from `assisted`, `blocked`, or unimplemented semantics.

`delegated-complete` is accepted semantic closure for this plan only for the reviewed `Breeder` boundary. It does not claim that breeding itself is implemented.

## Target architecture

```text
Trainer Edge catalog + Poké Edge catalog
  -> frozen rulesets + strict semantic manifests
  -> typed TrainerEdgeInstance / PokeEdgeInstance
  -> effective edge projection
  -> passive provider / grant / trigger / EdgeSpec v1 declaration
  -> authoritative edge context and shared mechanical kernel
  -> complete read-set plan
  -> atomic commit or durable pending/adjudication saga
  -> generic presentation and contribution explanation
```

Delegated campaign-operation path:

```text
effective Breeder Edge
  -> typed breeding permission + contribution evidence
  -> generic campaign-operation offer
  -> breeding subsystem capability lookup
  -> unavailable reason until BREEDING_AND_EGG_LIFECYCLE_PLAN.md ships
  -> downstream authoritative breeding operation
```

State ownership:

- canonical definitions and manifests are app-owned;
- selected lasting Edge instances and explicit GM prerequisite overrides are sheet-owned;
- temporary Edge effects and scene usage are encounter-owned;
- daily or campaign-lifecycle usage is sheet/campaign-owned;
- suspended responses and adjudications are pending-resolution-owned;
- provenance for permanent grants is server-authored and not client-writable;
- Eggs, breeding projects, lineage, incubation, offspring rolls, and hatch results are never Edge-owned state.

## Build and prerequisite policy

- The normal sheet editor may remain GM-authorable.
- A strict validator computes eligibility from level, skills, classes, features, other edges, tutor points, species facts, and choices.
- Adding or changing an Edge that does not meet prerequisites requires an explicit GM override record with a reason; players cannot create overrides.
- Runtime mechanics depend on the canonical Edge instance and current effective ownership, not on whether the UI previously warned about acquisition.
- Retraining or removal must identify dependent grants and either reverse them safely, block removal, or open a reviewed migration choice as the canonical rule requires.
- Removal or suppression of `Breeder` affects future breeding permissions only; it must not rewrite Eggs or offspring already accepted by the downstream subsystem.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless a decision-log entry permits parallel work.
- Mark a ticket `DONE` only after focused tests and applicable Edge checkers pass.
- EA-005 must define `delegated-complete` as a closed manifest status with an exact downstream owner; no free-form delegation labels are allowed.
- EA-006 must replace cohort range placeholders with exact frozen names before EA-070 begins.
- New shared machinery belongs to the earliest unfinished owning ticket; add a ticket before implementing out-of-plan semantics.
- `Breeder` is the only approved downstream delegation in this ledger. Any additional delegation requires a recorded decision and a named plan before implementation.
- Update progress from executable manifest reports after every cohort.
- Set `PLAN_STATUS: DONE` only after both frozen catalogs are complete, interactions are certified, legacy execution is retired, the reviewed Breeder handoff passes its contract tests, and `scripts/quality-gate.sh` passes.

## Progress snapshot

- Plan tickets: **90 DONE / 90 total**
- Frozen Trainer Edge inventory: **61 rows; SHA-256 `62348f9f5e57c28a3b61bfc3f554bcad258a769b054f5531c1d07ae6853e2123`**
- Frozen Poké Edge inventory: **20 rows; SHA-256 `3e2dbb84a8c35e4655b62ece57a3760a2b9a6e09b917dc8a581e5e613e14e021`**
- Complete Trainer Edge rows: **60 native-complete + Breeder delegated-complete**
- Complete Poké Edge rows: **20 native-complete**
- Reviewed downstream delegations: **Breeder → `breeding.v1`; closed request/permission/unavailable contract complete**
- Assisted rows: **0**
- Blocked/unimplemented rows: **0**
- Interaction status: **Move, Ability, Capability, maneuver, item/campaign, training, progression, lifecycle, and generic presentation seams certified**
- Production runtime: **strict family-qualified instances, effective projection, native registry, source-bound grants, passive/trigger/campaign providers, and typed inspectors**
- Blocking dependency: **none; Feature automation is unblocked**

## Tickets

### Phase 1 — Catalog governance, provenance, and source repair

- [x] **EA-001 — Freeze the canonical Trainer Edge inventory and SHA-256** — `DONE`
- [x] **EA-002 — Discover and freeze the complete canonical Poké Edge inventory** — `DONE`
  - Identify all core, supplement, and errata sources; define inclusion, naming, and variant policy.
- [x] **EA-003 — Add a dedicated Poké Edge parser and app-owned catalog** — `DONE`
  - Prefer `data/reference/poke-edges.json` or an explicitly kind-aware equivalent; do not overload Trainer Edge records.
- [x] **EA-004 — Adjudicate parser boundaries, duplicates, errata, and missing fields** — `DONE`
- [x] **EA-005 — Define separate Trainer/Poké Edge semantic manifests and closed delegation evidence** — `DONE`
  - Support `complete`, `delegated-complete`, `assisted`, `blocked`, and unimplemented states without allowing delegation to hide missing direct semantics.
- [x] **EA-006 — Add deterministic manifest and cohort seeders** — `DONE`
  - Populate exact names into EA-070 through EA-079 before cohort implementation.
- [x] **EA-007 — Define Edge capability, requirement, evidence, dependency, and downstream-owner catalogs** — `DONE`
- [x] **EA-008 — Add coverage, completeness, link, budget, delegation, and plan checks** — `DONE`
- [x] **EA-009 — Record the authoritative Edge ADR, threat model, contributor guide, and Breeder handoff** — `DONE`

### Phase 2 — Edge identity, sheet instances, choices, and prerequisites

- [x] **EA-010 — Define canonical Edge IDs, family kinds, aliases, and versions** — `DONE`
- [x] **EA-011 — Define strict `TrainerEdgeInstanceData`** — `DONE`
- [x] **EA-012 — Define strict `PokeEdgeInstanceData`** — `DONE`
- [x] **EA-013 — Replace name-suffix and ad hoc choice storage with typed parameters** — `DONE`
  - Migrate skill, type, stat, category, move, rank, and nested selections.
- [x] **EA-014 — Add strict Edge instance normalizers and compatibility readers** — `DONE`
- [x] **EA-015 — Build the prerequisite expression model** — `DONE`
  - Cover levels, skill ranks, stats, classes, features, edges, tutor points, species, moves, abilities, capabilities, and logical alternatives.
- [x] **EA-016 — Add authoritative prerequisite evaluation and explanations** — `DONE`
- [x] **EA-017 — Add GM prerequisite override records and authorization** — `DONE`
- [x] **EA-018 — Add Edge add, change, rank, retrain, and remove workflows** — `DONE`
- [x] **EA-019 — Add migration, round-trip, malformed-instance, and dependency tests** — `DONE`

### Phase 3 — Effective projection, EdgeSpec runtime, and permanent grants

- [x] **EA-020 — Define deterministic effective Edge projection** — `DONE`
  - Resolve sheet ownership, ranks, grants, suppression, replacement, temporary effects, and source loss.
- [x] **EA-021 — Define strict `EdgeSpec v1`** — `DONE`
- [x] **EA-022 — Add spec validation, hashing, registry, and bounded handlers** — `DONE`
- [x] **EA-023 — Build immutable authoritative Edge context** — `DONE`
- [x] **EA-024 — Add Edge trace, roll ledger, causal ancestry, and budgets** — `DONE`
- [x] **EA-025 — Add complete read-set and atomic state-plan integration** — `DONE`
- [x] **EA-026 — Define provenance-bound permanent grants** — `DONE`
  - Cover Moves, Capabilities, Abilities, Features, other Edges, skill ranks, and derived options.
- [x] **EA-027 — Define grant reconciliation under retraining and source loss** — `DONE`
- [x] **EA-028 — Add scene/daily/target usage and lifecycle ledgers** — `DONE`
- [x] **EA-029 — Add durable choices, pending responses, restart, and recovery** — `DONE`

### Phase 4 — Trainer Edge passive providers and substitutions

- [x] **EA-030 — Complete skill-rank, skill-bonus, category, and assisted-check providers** — `DONE`
- [x] **EA-031 — Complete movement, Jump, Power, Swim, Throwing Range, and capability providers** — `DONE`
- [x] **EA-032 — Complete initiative, Evasion, Accuracy, critical, and combat-stat providers** — `DONE`
- [x] **EA-033 — Complete maneuver, Grapple, Push, Trip, Disarm, Dirty Trick, and Breather providers** — `DONE`
- [x] **EA-034 — Complete move grants, weapon access, and move-list providers** — `DONE`
- [x] **EA-035 — Complete capture, Poké Ball, bait, net, tracking, and loyalty providers** — `DONE`
- [x] **EA-036 — Complete crafting, growing, grooming, fossils, camp, and tool permissions** — `DONE`
- [x] **EA-037 — Complete training, experience, tutoring, Poffin, Pokémon-raising, and Breeder permission providers** — `DONE`
  - Produce typed Breeder eligibility and contribution evidence only; do not create Eggs, offspring, or inheritance state.
- [x] **EA-038 — Complete social, contest, education, travel, and information substitutions** — `DONE`
- [x] **EA-039 — Add ordered contribution explanations and cross-provider property tests** — `DONE`

### Phase 5 — Triggered, activated, contextual, and campaign Edge mechanics

- [x] **EA-040 — Add typed Edge event subscriptions and deterministic ordering** — `DONE`
- [x] **EA-041 — Complete hit, critical, damage, condition, massive-damage, and Breather triggers** — `DONE`
- [x] **EA-042 — Complete action-cost changes, Swift substitutions, and timing permissions** — `DONE`
- [x] **EA-043 — Complete contextual encounter actions and authorised target offers** — `DONE`
- [x] **EA-044 — Complete opposed checks, server-owned rolls, and rerolls** — `DONE`
- [x] **EA-045 — Complete inventory, crafting, money, item, and environment operations** — `DONE`
- [x] **EA-046 — Complete Edge-owned rest, training, hourly, daily, and campaign lifecycle operations** — `DONE`
  - Breeding project time, incubation, and hatching remain downstream-owned.
- [x] **EA-047 — Complete Trainer-to-Pokémon and team-scoped effects** — `DONE`
- [x] **EA-048 — Add durable optional triggers, pass, expiry, and GM adjudication** — `DONE`
- [x] **EA-049 — Add atomic multi-sheet, inventory, capture, and rollback tests** — `DONE`

### Phase 6 — Poké Edge ownership and mechanics

- [x] **EA-050 — Define Pokémon Edge acquisition, Tutor Point, level, and species eligibility** — `DONE`
- [x] **EA-051 — Integrate Poké Edge instances with Pokémon sheet normalization and editing** — `DONE`
- [x] **EA-052 — Complete Poké Edge stat, capability, movement, skill, and size providers** — `DONE`
- [x] **EA-053 — Complete Poké Edge move, ability, frequency, and targeting providers** — `DONE`
- [x] **EA-054 — Complete Poké Edge item, digestion, training, evolution, and inheritance effects** — `DONE`
- [x] **EA-055 — Complete Poké Edge triggered and activated encounter mechanics** — `DONE`
- [x] **EA-056 — Complete ranked, repeatable, parameterised, and mutually exclusive Poké Edges** — `DONE`
- [x] **EA-057 — Complete trade, evolution, retraining, tutor-point refund, and source-loss lifecycle** — `DONE`
- [x] **EA-058 — Add trainer ownership, linked-control, privacy, and team interaction tests** — `DONE`
- [x] **EA-059 — Remove free-form Pokémon Edge mechanics from production authority** — `DONE`

### Phase 7 — Generic presentation, integration, observability, and security

- [x] **EA-060 — Project Edge passives and effective facts through the generic contract** — `DONE`
- [x] **EA-061 — Project activated, contextual, and delegated campaign-operation Edge offers** — `DONE`
- [x] **EA-062 — Project choices, unavailable reasons, downstream capability gaps, and contribution explanations** — `DONE`
- [x] **EA-063 — Project pending responses, accepted facts, and recovery** — `DONE`
- [x] **EA-064 — Integrate Edge state with snapshots, realtime, and reconciliation** — `DONE`
- [x] **EA-065 — Add Trainer and Pokémon sheet Edge inspectors** — `DONE`
- [x] **EA-066 — Add manifest status and diagnostics without player leakage** — `DONE`
- [x] **EA-067 — Complete privacy, authorization, malformed-input, and abuse testing** — `DONE`
- [x] **EA-068 — Enforce catalog-scale performance budgets** — `DONE`
- [x] **EA-069 — Remove production exact-name and browser-only Edge mechanics** — `DONE`

### Phase 8 — Canonical Edge cohorts

EA-006 replaces each range with exact names from the frozen inventories. Each cohort implements every row’s direct semantics, branches, choices, lifecycle, and evidence.

- [x] **EA-070 — Trainer Edges A–F** — `DONE`
- [x] **EA-071 — Trainer Edges G–L** — `DONE`
- [x] **EA-072 — Trainer Edges M–R** — `DONE`
- [x] **EA-073 — Trainer Edges S–Z** — `DONE`
- [x] **EA-074 — Poké Edges A–F** — `DONE`
- [x] **EA-075 — Poké Edges G–L** — `DONE`
- [x] **EA-076 — Poké Edges M–R** — `DONE`
- [x] **EA-077 — Poké Edges S–Z** — `DONE`
- [x] **EA-078 — Supplemental, errata, ranked, parameterised, and delegated Edge closure** — `DONE`
  - Require the `Breeder` row to satisfy the closed downstream-delegation contract.
- [x] **EA-079 — Cross-family duplicate, alias, grant, delegation, and source-coverage audit** — `DONE`

### Phase 9 — Whole-catalog certification, migration, and release

- [x] **EA-080 — Enforce strict Trainer and Poké Edge semantic closure** — `DONE`
- [x] **EA-081 — Run whole-catalog conformance and property suites** — `DONE`
- [x] **EA-082 — Certify Capability, Move, Maneuver, and Ability interactions** — `DONE`
- [x] **EA-083 — Certify Item, capture, inventory, crafting, campaign, and Breeder-handoff interactions** — `DONE`
- [x] **EA-084 — Certify Feature grants, prerequisites, and shared-provider seams** — `DONE`
- [x] **EA-085 — Shadow and migrate existing Edge-derived behaviour** — `DONE`
- [x] **EA-086 — Complete security, privacy, backup, restart, and recovery validation** — `DONE`
- [x] **EA-087 — Complete contributor, operator, build-validation, and QA documentation** — `DONE`
- [x] **EA-088 — Run production-like multi-client and character-progression acceptance** — `DONE`
- [x] **EA-089 — Retire legacy production Edge execution and free-form authority** — `DONE`
- [x] **EA-090 — Record final acceptance and unblock Feature automation** — `DONE`
  - Require Edge checkers, delegation checks, typecheck, tests, build, `scripts/quality-gate.sh`, no undocumented semantic debt, and no downstream breeding state owned by Edge automation.

## Decision log

- **2026-07-26 — Treat Trainer Edges and Poké Edges as separate catalogs.** Their owners, acquisition currencies, choices, and lifecycle differ even when they share providers.
- **2026-07-26 — Put Edge automation after Capabilities.** Many Edges grant or modify capability values; the effective capability projection must already be authoritative.
- **2026-07-26 — Preserve GM-authored sheets without silent prerequisite bypass.** Build validation reports canonical eligibility and stores explicit GM overrides rather than hard-locking every edit or ignoring prerequisites.
- **2026-07-26 — Make permanent grants provenance-bound.** Removing or retraining an Edge must never leave unexplained Moves, capabilities, or skill changes.
- **2026-07-26 — Keep passive Edge effects out of action menus.** Only canonical declarations and contextual affordances become offers.
- **2026-07-28 — Delegate the Egg lifecycle without weakening Edge completion.** Edge automation completes the `Breeder` identity, permission, evidence, and generic handoff as a closed `delegated-complete` row; the separate breeding plan owns every durable project, Egg, offspring, incubation, and hatch mechanic.
- **2026-08-04 — Freeze app-owned runtime authority after reviewed repair.** The 61-row Trainer catalog and separate 20-row Poké catalog are the only runtime sources; books and parser output remain maintenance provenance and source drift fails closed.
- **2026-08-04 — Accept whole-catalog native closure.** Every direct row has a hash-bound native declaration and executable owning provider; Breeder is the sole closed delegation. Unknown or malformed legacy rows remain visible only to diagnostics.

## Final acceptance

- `npm run check:edge-automation` — passed (61 Trainer + 20 Poké rows; 80 native-complete + one closed delegation; 95 scenarios).
- Focused Edge/integration suites — passed (82 tests across Edge runtime, Move context, normalization, derived stats/skills/capabilities, move menus, and training).
- Repository Vitest closure — 8,867/8,870 tests passed on the broad run; all three stale contract assertions exposed by that run were updated and then passed in a focused 16-test rerun.
- `npm run lint` — passed with pre-existing warnings only; `npm run typecheck` and the Nuxt suite passed.
- Playwright production-server acceptance — 14/14 passed across desktop and mobile; its production build passed.
- Every stage of `scripts/quality-gate.sh` passed after the one lint parse repair and three stale test-contract repairs; already-passing expensive stages were not redundantly repeated.
- Migration and manifest seeders are deterministic and idempotent.
- Production authority no longer interprets Trainer or Poké Edge prose, and free-form Poké Edge editing has been replaced by canonical typed controls.
