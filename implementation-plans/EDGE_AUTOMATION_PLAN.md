# Edge Automation Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: EA-001`

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

- Plan tickets: **0 DONE / 90 total**
- Frozen Trainer Edge inventory: **pending EA-001**
- Frozen Poké Edge inventory: **pending EA-002**
- Complete Trainer Edge rows: **0**
- Complete Poké Edge rows: **0**
- Reviewed downstream delegations: **Breeder → breeding lifecycle plan; contract not started**
- Assisted rows: **0**
- Blocked/unimplemented rows: **pending frozen inventory**
- Interaction status: **unassessed**
- Production runtime: **partial sheet helpers only**
- Blocking dependency: **none; Capability automation final acceptance is complete**

## Tickets

### Phase 1 — Catalog governance, provenance, and source repair

- [ ] **EA-001 — Freeze the canonical Trainer Edge inventory and SHA-256** — `IN_PROGRESS`
- [ ] **EA-002 — Discover and freeze the complete canonical Poké Edge inventory** — `TODO`
  - Identify all core, supplement, and errata sources; define inclusion, naming, and variant policy.
- [ ] **EA-003 — Add a dedicated Poké Edge parser and app-owned catalog** — `TODO`
  - Prefer `data/reference/poke-edges.json` or an explicitly kind-aware equivalent; do not overload Trainer Edge records.
- [ ] **EA-004 — Adjudicate parser boundaries, duplicates, errata, and missing fields** — `TODO`
- [ ] **EA-005 — Define separate Trainer/Poké Edge semantic manifests and closed delegation evidence** — `TODO`
  - Support `complete`, `delegated-complete`, `assisted`, `blocked`, and unimplemented states without allowing delegation to hide missing direct semantics.
- [ ] **EA-006 — Add deterministic manifest and cohort seeders** — `TODO`
  - Populate exact names into EA-070 through EA-079 before cohort implementation.
- [ ] **EA-007 — Define Edge capability, requirement, evidence, dependency, and downstream-owner catalogs** — `TODO`
- [ ] **EA-008 — Add coverage, completeness, link, budget, delegation, and plan checks** — `TODO`
- [ ] **EA-009 — Record the authoritative Edge ADR, threat model, contributor guide, and Breeder handoff** — `TODO`

### Phase 2 — Edge identity, sheet instances, choices, and prerequisites

- [ ] **EA-010 — Define canonical Edge IDs, family kinds, aliases, and versions** — `TODO`
- [ ] **EA-011 — Define strict `TrainerEdgeInstanceData`** — `TODO`
- [ ] **EA-012 — Define strict `PokeEdgeInstanceData`** — `TODO`
- [ ] **EA-013 — Replace name-suffix and ad hoc choice storage with typed parameters** — `TODO`
  - Migrate skill, type, stat, category, move, rank, and nested selections.
- [ ] **EA-014 — Add strict Edge instance normalizers and compatibility readers** — `TODO`
- [ ] **EA-015 — Build the prerequisite expression model** — `TODO`
  - Cover levels, skill ranks, stats, classes, features, edges, tutor points, species, moves, abilities, capabilities, and logical alternatives.
- [ ] **EA-016 — Add authoritative prerequisite evaluation and explanations** — `TODO`
- [ ] **EA-017 — Add GM prerequisite override records and authorization** — `TODO`
- [ ] **EA-018 — Add Edge add, change, rank, retrain, and remove workflows** — `TODO`
- [ ] **EA-019 — Add migration, round-trip, malformed-instance, and dependency tests** — `TODO`

### Phase 3 — Effective projection, EdgeSpec runtime, and permanent grants

- [ ] **EA-020 — Define deterministic effective Edge projection** — `TODO`
  - Resolve sheet ownership, ranks, grants, suppression, replacement, temporary effects, and source loss.
- [ ] **EA-021 — Define strict `EdgeSpec v1`** — `TODO`
- [ ] **EA-022 — Add spec validation, hashing, registry, and bounded handlers** — `TODO`
- [ ] **EA-023 — Build immutable authoritative Edge context** — `TODO`
- [ ] **EA-024 — Add Edge trace, roll ledger, causal ancestry, and budgets** — `TODO`
- [ ] **EA-025 — Add complete read-set and atomic state-plan integration** — `TODO`
- [ ] **EA-026 — Define provenance-bound permanent grants** — `TODO`
  - Cover Moves, Capabilities, Abilities, Features, other Edges, skill ranks, and derived options.
- [ ] **EA-027 — Define grant reconciliation under retraining and source loss** — `TODO`
- [ ] **EA-028 — Add scene/daily/target usage and lifecycle ledgers** — `TODO`
- [ ] **EA-029 — Add durable choices, pending responses, restart, and recovery** — `TODO`

### Phase 4 — Trainer Edge passive providers and substitutions

- [ ] **EA-030 — Complete skill-rank, skill-bonus, category, and assisted-check providers** — `TODO`
- [ ] **EA-031 — Complete movement, Jump, Power, Swim, Throwing Range, and capability providers** — `TODO`
- [ ] **EA-032 — Complete initiative, Evasion, Accuracy, critical, and combat-stat providers** — `TODO`
- [ ] **EA-033 — Complete maneuver, Grapple, Push, Trip, Disarm, Dirty Trick, and Breather providers** — `TODO`
- [ ] **EA-034 — Complete move grants, weapon access, and move-list providers** — `TODO`
- [ ] **EA-035 — Complete capture, Poké Ball, bait, net, tracking, and loyalty providers** — `TODO`
- [ ] **EA-036 — Complete crafting, growing, grooming, fossils, camp, and tool permissions** — `TODO`
- [ ] **EA-037 — Complete training, experience, tutoring, Poffin, Pokémon-raising, and Breeder permission providers** — `TODO`
  - Produce typed Breeder eligibility and contribution evidence only; do not create Eggs, offspring, or inheritance state.
- [ ] **EA-038 — Complete social, contest, education, travel, and information substitutions** — `TODO`
- [ ] **EA-039 — Add ordered contribution explanations and cross-provider property tests** — `TODO`

### Phase 5 — Triggered, activated, contextual, and campaign Edge mechanics

- [ ] **EA-040 — Add typed Edge event subscriptions and deterministic ordering** — `TODO`
- [ ] **EA-041 — Complete hit, critical, damage, condition, massive-damage, and Breather triggers** — `TODO`
- [ ] **EA-042 — Complete action-cost changes, Swift substitutions, and timing permissions** — `TODO`
- [ ] **EA-043 — Complete contextual encounter actions and authorised target offers** — `TODO`
- [ ] **EA-044 — Complete opposed checks, server-owned rolls, and rerolls** — `TODO`
- [ ] **EA-045 — Complete inventory, crafting, money, item, and environment operations** — `TODO`
- [ ] **EA-046 — Complete Edge-owned rest, training, hourly, daily, and campaign lifecycle operations** — `TODO`
  - Breeding project time, incubation, and hatching remain downstream-owned.
- [ ] **EA-047 — Complete Trainer-to-Pokémon and team-scoped effects** — `TODO`
- [ ] **EA-048 — Add durable optional triggers, pass, expiry, and GM adjudication** — `TODO`
- [ ] **EA-049 — Add atomic multi-sheet, inventory, capture, and rollback tests** — `TODO`

### Phase 6 — Poké Edge ownership and mechanics

- [ ] **EA-050 — Define Pokémon Edge acquisition, Tutor Point, level, and species eligibility** — `TODO`
- [ ] **EA-051 — Integrate Poké Edge instances with Pokémon sheet normalization and editing** — `TODO`
- [ ] **EA-052 — Complete Poké Edge stat, capability, movement, skill, and size providers** — `TODO`
- [ ] **EA-053 — Complete Poké Edge move, ability, frequency, and targeting providers** — `TODO`
- [ ] **EA-054 — Complete Poké Edge item, digestion, training, evolution, and inheritance effects** — `TODO`
- [ ] **EA-055 — Complete Poké Edge triggered and activated encounter mechanics** — `TODO`
- [ ] **EA-056 — Complete ranked, repeatable, parameterised, and mutually exclusive Poké Edges** — `TODO`
- [ ] **EA-057 — Complete trade, evolution, retraining, tutor-point refund, and source-loss lifecycle** — `TODO`
- [ ] **EA-058 — Add trainer ownership, linked-control, privacy, and team interaction tests** — `TODO`
- [ ] **EA-059 — Remove free-form Pokémon Edge mechanics from production authority** — `TODO`

### Phase 7 — Generic presentation, integration, observability, and security

- [ ] **EA-060 — Project Edge passives and effective facts through the generic contract** — `TODO`
- [ ] **EA-061 — Project activated, contextual, and delegated campaign-operation Edge offers** — `TODO`
- [ ] **EA-062 — Project choices, unavailable reasons, downstream capability gaps, and contribution explanations** — `TODO`
- [ ] **EA-063 — Project pending responses, accepted facts, and recovery** — `TODO`
- [ ] **EA-064 — Integrate Edge state with snapshots, realtime, and reconciliation** — `TODO`
- [ ] **EA-065 — Add Trainer and Pokémon sheet Edge inspectors** — `TODO`
- [ ] **EA-066 — Add manifest status and diagnostics without player leakage** — `TODO`
- [ ] **EA-067 — Complete privacy, authorization, malformed-input, and abuse testing** — `TODO`
- [ ] **EA-068 — Enforce catalog-scale performance budgets** — `TODO`
- [ ] **EA-069 — Remove production exact-name and browser-only Edge mechanics** — `TODO`

### Phase 8 — Canonical Edge cohorts

EA-006 replaces each range with exact names from the frozen inventories. Each cohort implements every row’s direct semantics, branches, choices, lifecycle, and evidence.

- [ ] **EA-070 — Trainer Edges A–F** — `TODO`
- [ ] **EA-071 — Trainer Edges G–L** — `TODO`
- [ ] **EA-072 — Trainer Edges M–R** — `TODO`
- [ ] **EA-073 — Trainer Edges S–Z** — `TODO`
- [ ] **EA-074 — Poké Edges A–F** — `TODO`
- [ ] **EA-075 — Poké Edges G–L** — `TODO`
- [ ] **EA-076 — Poké Edges M–R** — `TODO`
- [ ] **EA-077 — Poké Edges S–Z** — `TODO`
- [ ] **EA-078 — Supplemental, errata, ranked, parameterised, and delegated Edge closure** — `TODO`
  - Require the `Breeder` row to satisfy the closed downstream-delegation contract.
- [ ] **EA-079 — Cross-family duplicate, alias, grant, delegation, and source-coverage audit** — `TODO`

### Phase 9 — Whole-catalog certification, migration, and release

- [ ] **EA-080 — Enforce strict Trainer and Poké Edge semantic closure** — `TODO`
- [ ] **EA-081 — Run whole-catalog conformance and property suites** — `TODO`
- [ ] **EA-082 — Certify Capability, Move, Maneuver, and Ability interactions** — `TODO`
- [ ] **EA-083 — Certify Item, capture, inventory, crafting, campaign, and Breeder-handoff interactions** — `TODO`
- [ ] **EA-084 — Certify Feature grants, prerequisites, and shared-provider seams** — `TODO`
- [ ] **EA-085 — Shadow and migrate existing Edge-derived behaviour** — `TODO`
- [ ] **EA-086 — Complete security, privacy, backup, restart, and recovery validation** — `TODO`
- [ ] **EA-087 — Complete contributor, operator, build-validation, and QA documentation** — `TODO`
- [ ] **EA-088 — Run production-like multi-client and character-progression acceptance** — `TODO`
- [ ] **EA-089 — Retire legacy production Edge execution and free-form authority** — `TODO`
- [ ] **EA-090 — Record final acceptance and unblock Feature automation** — `TODO`
  - Require Edge checkers, delegation checks, typecheck, tests, build, `scripts/quality-gate.sh`, no undocumented semantic debt, and no downstream breeding state owned by Edge automation.

## Decision log

- **2026-07-26 — Treat Trainer Edges and Poké Edges as separate catalogs.** Their owners, acquisition currencies, choices, and lifecycle differ even when they share providers.
- **2026-07-26 — Put Edge automation after Capabilities.** Many Edges grant or modify capability values; the effective capability projection must already be authoritative.
- **2026-07-26 — Preserve GM-authored sheets without silent prerequisite bypass.** Build validation reports canonical eligibility and stores explicit GM overrides rather than hard-locking every edit or ignoring prerequisites.
- **2026-07-26 — Make permanent grants provenance-bound.** Removing or retraining an Edge must never leave unexplained Moves, capabilities, or skill changes.
- **2026-07-26 — Keep passive Edge effects out of action menus.** Only canonical declarations and contextual affordances become offers.
- **2026-07-28 — Delegate the Egg lifecycle without weakening Edge completion.** Edge automation completes the `Breeder` identity, permission, evidence, and generic handoff as a closed `delegated-complete` row; the separate breeding plan owns every durable project, Egg, offspring, incubation, and hatch mechanic.
