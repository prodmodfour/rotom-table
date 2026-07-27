# Feature Automation Implementation Plan

`PLAN_STATUS: QUEUED`

`CURRENT_TICKET: FA-001`

`BLOCKED_BY: EDGE_AUTOMATION_PLAN.md — PLAN_STATUS: DONE`

## Goal

Implement complete, server-authoritative automation for every canonical Trainer Feature in `data/reference/features.json`, including General Features, Class and Branch Features, Orders, Training Features, Stratagems, Weapon Features, Ranked and Gift Features, AP Bind/Drain mechanics, triggered effects, passive providers, permanent grants, tutoring, capture, crafting, research, social, travel, and other campaign operations.

Features are the broadest rules catalog in this sequence. They may define character-building structure, grant other rules, modify a Trainer, command or train Pokémon, create actions, subscribe to encounter events, or operate over hours and days. The implementation must cover all of those roles without reducing “Feature automation” to an oversized button menu.

This file is the durable implementation ledger for Feature automation. It begins only after Capabilities and both Edge families are complete, so Feature grants and dependencies have stable authoritative owners.

## Canonical scope and baseline

- Canonical source: `data/reference/features.json`
- Current Git blob SHA at plan creation: `4e0b22c15ecea225b061086f403bca49658608b1`
- Current parser: `ptu-data/parse_features_edges.py`
- Current source hierarchy includes errata, Trainer Classes, and Skills/Edges/Features source material.
- Current reference shape includes name, tags, prerequisites, frequency, trigger, target, condition, effect, and optional `className`.
- Current sheet owner: `TrainerSheet.features`, with separate `TrainerSheet.classes`, `orders`, `trainingFeature`, choices, notes, and frequency overrides.
- Current parser output visibly requires a full source-boundary and class-context audit before it can be frozen; merged effects, misplaced class ownership, errata transitions, ranked clauses, and inline section text must fail closed rather than becoming mechanics.
- Exact count, SHA-256, canonical order, class/branch directory, tag taxonomy, source-byte hashes, duplicate policy, and parser adjudications must be frozen by FA-001 through FA-004.
- Existing Orders, training, class choices, sheet derivations, capture actions, item flows, Move/Ability helpers, and exact-name hooks are migration inputs only.
- Every source row remains in scope even when it is primarily character-building, narrative, out-of-combat, GM-adjudicated, or grants another rule rather than directly changing encounter state.

## Non-negotiable rules

1. **Every frozen Feature row is in scope.** General, Class, Branch, Orders, Training, Stratagem, Weapon, Ranked, Gift, crafting, research, social, and campaign Features all require an authoritative implementation role.
2. **No runtime prose interpretation.** Canonical text becomes strict specs, grants, providers, choices, subscriptions, campaign operations, or bounded handlers.
3. **Feature taxonomy is not UI taxonomy.** Tags and class ownership drive rules and provenance; they do not mandate separate permanent panels.
4. **Character-building and live mechanics are distinct.** Class membership, prerequisites, ranks, choices, and grants are validated separately from encounter declarations.
5. **One effective Feature projection.** Sheet instances, classes, ranks, grants, replacement, suppression, retraining, and temporary effects resolve deterministically.
6. **AP is authoritative.** Max, current, spent, bound, drained, temporary, payment timing, release, rest, retry, and nested costs are server-owned.
7. **Orders and Training validate relationships.** Trainer control, team membership, command range, targets, active training, scenes, and linked profiles are derived from current authority.
8. **Permanent grants retain provenance.** Moves, Abilities, Capabilities, Edges, Features, skills, stats, and recipes can be reconciled under retraining or source loss.
9. **Canonical GM discretion is typed.** The server constrains legal judgement shape and persistence; the authorised GM supplies only the choice the rule delegates.
10. **Campaign operations are first-class.** Tutoring, crafting, research, camp, medical care, travel, social, contest, and downtime effects use authoritative resources and lifecycle.
11. **Atomicity and exact retry apply.** Multi-sheet, team, inventory, shop, campaign, and encounter writes commit atomically or through durable sagas.
12. **Privacy is role- and target-aware.** Hidden builds, private Features, chosen specialisations, eligible recipients, research results, and GM overrides are projected safely.
13. **Generic presentation only.** Actions, passives, contextual affordances, choices, reasons, explanations, pending responses, and accepted outcomes use the shared automation contract.
14. **Interaction honesty.** Base Feature completion and interactions with Moves, Abilities, Capabilities, Edges, Items, conditions, terrain, capture, and campaign systems are certified separately.
15. **No hidden manual debt.** A complicated Feature may use a typed adjudication or durable workflow, but a “complete” manifest row cannot rely on prose-only execution.

## Semantic completion contract

A Feature row may be marked `complete` only when all applicable clauses satisfy the following:

- canonical identity, tags, class/branch ownership, ranks, repeatability, prerequisites, choices, frequency, action type, AP cost, trigger, target, condition, duration, reset, and source provenance are encoded;
- the Feature instance stores stable typed choices for type, stat, skill, move, ability, edge, feature, class branch, weapon, recipe, Pokémon, or other canonical selections;
- acquisition and class progression validation explain eligibility and retain explicit GM overrides without rewriting source rules;
- passive and static effects automatically participate in every owning query and do not become invocable actions;
- activated, Priority, Interrupt, Reaction, Orders, and contextual actions validate effective ownership, AP/frequency/action resources, targets, relationships, range, geometry, and prerequisites on the server;
- trigger subscriptions consume typed accepted events at exact timing checkpoints and are deterministic under nesting;
- Orders, Training, team, and Pokémon-targeted effects validate roster/profile control, current map placement, side, willingness, command range, and scene state;
- permanent grants and replacements are idempotent, provenance-bound, and reconciled under retraining or source loss;
- campaign operations validate time, location, tools, money, inventory, recipes, skill checks, targets, and lasting state;
- all randomness and checks are server-owned, bounded, injected for tests, and retained in a replay-safe ledger;
- all consulted map, sheet, group inventory, shop, campaign, reference, history, and object revisions join the read set;
- all writes commit atomically or through an explicit durable pending/adjudication saga;
- reconnect, exact retry, stale conflicts, pass, cancellation, expiry, abandonment, recovery, rest, retraining, and source loss are tested where applicable;
- executable scenarios cover every branch, rank, target variation, cap, prevention, no-op, choice, lifecycle, and direct interaction required by the Feature’s own text;
- the semantic manifest points to reviewed runtime/hash/source evidence and has no blocker, limitation, manual step, or hidden interaction exclusion;
- generic public, owner, GM, and diagnostic presentation is downstream of accepted mechanics.

## Target architecture

```text
canonical Feature catalog
  -> repaired frozen source + class/tag directory
  -> strict Feature semantic manifest
  -> typed FeatureInstanceData and class progression state
  -> effective Feature projection
  -> passive provider / grant / event subscription / FeatureSpec v1 action
  -> authoritative Feature context and shared mechanical kernel
  -> complete read-set state plan
  -> atomic commit or durable pending/campaign saga
  -> generic accepted presentation and contribution explanation
```

Feature ownership layers:

```text
Trainer class and feature sheet instances
  + ranked and repeated instances
  + permanent grants from classes/features/edges/items
  + temporary encounter Feature effects
  - replacements, suppression, retraining, and source loss
  = authoritative effective Feature view
```

## Feature family policy

The frozen manifest assigns one or more roles while preserving source tags:

- `class-anchor`
- `branch-anchor`
- `ranked-progression`
- `passive-provider`
- `permanent-grant`
- `activated-action`
- `orders-action`
- `training-operation`
- `stratagem`
- `weapon-provider`
- `triggered-automatic`
- `triggered-optional`
- `interrupt-reaction`
- `contextual-affordance`
- `campaign-operation`
- `crafting-or-research`
- `gm-adjudicated`
- `classification-only`

A Feature can combine roles. Tags alone never substitute for reviewed semantics.

## AP and frequency policy

- AP state remains a versioned Trainer-sheet resource with explicit max, available, spent, bound, drained, and temporary components.
- Payment phases are source-reviewed: declaration, after target choice, after trigger acceptance, after success, after rest, or other exact checkpoints.
- Bound AP has a typed owner, effect identity, release conditions, and source-loss policy.
- Drained AP has a typed recovery boundary and cannot be restored by browser edits during live play.
- Temporary AP has an expiry and cannot pay costs that canonical rules disallow.
- Feature usage supports At-Will, EOT, Scene xN, Daily xN, one-time, per-target, per-round, per-turn, and reviewed special frequencies.
- Exact retries reuse payment and usage evidence.

## Build and class progression policy

- Class, Branch, Feature, and rank prerequisites use a strict expression model.
- The normal GM sheet editor remains authorable but stores explicit override provenance for unmet prerequisites.
- Class anchors establish class identity; Branch selections use stable specialisation data, not display-name suffixes.
- Ranked Features use one canonical instance with rank state unless source semantics require independent instances.
- Dependent Features and permanent grants are enumerated before retraining or removal.
- Character-building validation never becomes a hidden runtime prerequisite parser.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless a decision-log entry permits safe parallel work.
- Mark a ticket `DONE` only after focused tests and all applicable Feature checkers pass.
- FA-006 must generate exact nonempty class-aware cohort rosters for FA-070 through FA-099 before cohort implementation.
- If the frozen count requires additional cohort tickets, insert them before FA-100 rather than increasing cohort size beyond the reviewed limit.
- New reusable machinery belongs to the earliest unfinished owning ticket; add a ticket before implementing out-of-plan semantics.
- Update progress from executable manifest reports after every cohort.
- Set `PLAN_STATUS: DONE` only after every frozen row and interaction is certified, legacy production execution is retired, and `scripts/quality-gate.sh` passes.

## Progress snapshot

- Plan tickets: **0 DONE / 110 total**
- Frozen canonical inventory: **pending FA-001**
- Frozen class/branch directory: **pending FA-002**
- Complete Feature rows: **0**
- Assisted rows: **0**
- Blocked/unimplemented rows: **pending inventory**
- Interaction status: **unassessed**
- Production runtime: **partial Orders/training/sheet helpers only**
- Blocking dependency: **Edge automation final acceptance**

## Tickets

### Phase 1 — Source repair, catalog governance, and honest coverage

- [ ] **FA-001 — Freeze the canonical Feature inventory and SHA-256** — `TODO`
- [ ] **FA-002 — Freeze the class, branch, tag, rank, and source directory** — `TODO`
- [ ] **FA-003 — Audit parser boundaries, class context, merged prose, and errata precedence** — `TODO`
- [ ] **FA-004 — Add source-hash-bound adjudications for every catalog defect** — `TODO`
- [ ] **FA-005 — Define the Feature semantic manifest and completion schema** — `TODO`
- [ ] **FA-006 — Add deterministic class-aware manifest and cohort seeders** — `TODO`
  - Create nonempty cohorts of at most 16 rows, keep class families together where practical, and write exact names into FA-070 through FA-099.
- [ ] **FA-007 — Define Feature requirement, evidence, dependency, and interaction catalogs** — `TODO`
- [ ] **FA-008 — Add coverage, completeness, link, source, budget, and plan checks** — `TODO`
- [ ] **FA-009 — Record the Feature runtime ADR, threat model, contributor guide, and baseline audit** — `TODO`

### Phase 2 — Feature identities, instances, classes, choices, and prerequisites

- [ ] **FA-010 — Define canonical Feature IDs, aliases, versions, and source tags** — `TODO`
- [ ] **FA-011 — Define strict `FeatureInstanceData`** — `TODO`
- [ ] **FA-012 — Define class and branch instance state** — `TODO`
- [ ] **FA-013 — Define ranked, repeatable, Gift, and nested-choice instances** — `TODO`
- [ ] **FA-014 — Replace name suffixes, notes, and ad hoc fields with typed choices** — `TODO`
- [ ] **FA-015 — Build the complete Feature prerequisite expression model** — `TODO`
  - Cover level, skills, stats, classes, branches, Features, Edges, Capabilities, Moves, Abilities, items, tutor points, milestones, and logical alternatives.
- [ ] **FA-016 — Add authoritative eligibility and progression explanations** — `TODO`
- [ ] **FA-017 — Add GM override records and authorization** — `TODO`
- [ ] **FA-018 — Add class/Feature add, rank, branch, retrain, replace, and remove workflows** — `TODO`
- [ ] **FA-019 — Add migration, round-trip, dependency, and malformed-instance tests** — `TODO`

### Phase 3 — Effective projection, FeatureSpec runtime, AP, and state planning

- [ ] **FA-020 — Define deterministic effective Feature projection** — `TODO`
- [ ] **FA-021 — Define strict `FeatureSpec v1`** — `TODO`
- [ ] **FA-022 — Add spec normalization, validation, hashing, registry, and pure handlers** — `TODO`
- [ ] **FA-023 — Build immutable authoritative Feature context** — `TODO`
- [ ] **FA-024 — Add Feature trace, roll ledger, causal ancestry, and budgets** — `TODO`
- [ ] **FA-025 — Add complete read-set and atomic state-plan integration** — `TODO`
- [ ] **FA-026 — Rebuild AP payment, Bind, Drain, temporary AP, and release semantics** — `TODO`
- [ ] **FA-027 — Add Feature frequency, cooldown, once, and lifecycle ledgers** — `TODO`
- [ ] **FA-028 — Add durable Feature choices, reactions, adjudications, and campaign sagas** — `TODO`
- [ ] **FA-029 — Add restart, backup, export, exact retry, abandonment, and recovery** — `TODO`

### Phase 4 — Passive providers, permanent grants, and derived Trainer mechanics

- [ ] **FA-030 — Complete stat, HP, Evasion, initiative, Damage Reduction, and Combat Stage providers** — `TODO`
- [ ] **FA-031 — Complete skill rank, skill bonus, substitution, category, and assisted-check providers** — `TODO`
- [ ] **FA-032 — Complete movement, capability, size, reach, weapon, and equipment providers** — `TODO`
- [ ] **FA-033 — Complete Accuracy, damage, Damage Base, critical, type, STAB, and immunity providers** — `TODO`
- [ ] **FA-034 — Complete condition, save, cure, injury, healing, temporary HP, and rest providers** — `TODO`
- [ ] **FA-035 — Complete Move, Maneuver, Ability, Capability, Edge, and Feature grants** — `TODO`
- [ ] **FA-036 — Complete move-list replacement, tutoring, connection, frequency, and usage changes** — `TODO`
- [ ] **FA-037 — Complete inventory, money, item, equipment, recipe, and held-item providers** — `TODO`
- [ ] **FA-038 — Add provenance-bound grant reconciliation and source-loss policy** — `TODO`
- [ ] **FA-039 — Add ordered contribution explanations and provider property tests** — `TODO`

### Phase 5 — Orders, Training, team control, and Pokémon-targeted Features

- [ ] **FA-040 — Define authoritative Orders declarations and target relationships** — `TODO`
- [ ] **FA-041 — Complete normal, Priority, Interrupt, and Reaction Orders timing** — `TODO`
- [ ] **FA-042 — Complete Training Feature application, replacement, and Extended Rest lifecycle** — `TODO`
- [ ] **FA-043 — Complete Trainer-to-Pokémon range, command, side, willingness, and roster queries** — `TODO`
- [ ] **FA-044 — Complete team, active party, boxed Pokémon, send-out, recall, and switch interactions** — `TODO`
- [ ] **FA-045 — Complete trainer action sharing, Pokémon action modification, and nested execution** — `TODO`
- [ ] **FA-046 — Complete marks, cheered/trained states, auras, side effects, and scene resources** — `TODO`
- [ ] **FA-047 — Complete Experience, Tutor Point, loyalty, inheritance, and training operations** — `TODO`
- [ ] **FA-048 — Add multi-Trainer, competing Orders, and ownership-transfer semantics** — `TODO`
- [ ] **FA-049 — Add team-scale atomicity, privacy, retry, and multi-client tests** — `TODO`

### Phase 6 — Trigger routing, combat actions, Stratagems, and Weapon Features

- [ ] **FA-050 — Add typed Feature event subscriptions and deterministic ordering** — `TODO`
- [ ] **FA-051 — Complete declaration, hit, miss, critical, damage, contact, and effectiveness triggers** — `TODO`
- [ ] **FA-052 — Complete HP, injury, condition, stage, save, faint, and recovery triggers** — `TODO`
- [ ] **FA-053 — Complete movement, adjacency, interception, terrain, hazard, and zone triggers** — `TODO`
- [ ] **FA-054 — Complete item, capture, switch, initiative, turn, round, scene, and rest triggers** — `TODO`
- [ ] **FA-055 — Complete activated combat Features and authoritative targeting** — `TODO`
- [ ] **FA-056 — Complete Stratagem binding, ownership, activation, and cleanup** — `TODO`
- [ ] **FA-057 — Complete Weapon Feature moves, slots, handedness, disarm, and equipment state** — `TODO`
- [ ] **FA-058 — Add nested trigger cycle prevention, priority, and causal budgets** — `TODO`
- [ ] **FA-059 — Add durable optional triggers, pass, force-pass, expiry, and GM recovery** — `TODO`

### Phase 7 — Capture, items, crafting, research, social, and campaign operations

- [ ] **FA-060 — Complete Capture Feature rolls, modifiers, stacks, throws, and species-family history** — `TODO`
- [ ] **FA-061 — Complete Restorative, medical, clinic, injury, and care workflows** — `TODO`
- [ ] **FA-062 — Complete crafting, scrap, recipes, tools, Apricorn, food, and equipment workflows** — `TODO`
- [ ] **FA-063 — Complete research, Pokédex, identification, fossil, technology, and education workflows** — `TODO`
- [ ] **FA-064 — Complete camp, travel, weather, wilderness, scouting, and environment workflows** — `TODO`
- [ ] **FA-065 — Complete social, disposition, charm, intimidation, command, and information workflows** — `TODO`
- [ ] **FA-066 — Complete contests, fashion, performance, beauty, and non-combat scene workflows** — `TODO`
- [ ] **FA-067 — Complete extended-time, daily, weekly, one-time, and campaign lifecycle state** — `TODO`
- [ ] **FA-068 — Add typed GM adjudication for open-ended canonical clauses** — `TODO`
- [ ] **FA-069 — Add campaign-operation atomicity, audit, rollback, and recovery tests** — `TODO`

### Phase 8 — Canonical Feature cohorts

Each cohort is generated by FA-006 from the frozen catalog. Cohorts contain at most 16 rows, keep a class family together where that does not exceed the limit, and otherwise follow canonical identity order. Empty slots are prohibited; if fewer than 30 cohorts are required, unused tickets are removed before this phase starts. If more are required, additional tickets are inserted before FA-100.

- [ ] **FA-070 — Canonical Feature cohort 01** — `TODO`
- [ ] **FA-071 — Canonical Feature cohort 02** — `TODO`
- [ ] **FA-072 — Canonical Feature cohort 03** — `TODO`
- [ ] **FA-073 — Canonical Feature cohort 04** — `TODO`
- [ ] **FA-074 — Canonical Feature cohort 05** — `TODO`
- [ ] **FA-075 — Canonical Feature cohort 06** — `TODO`
- [ ] **FA-076 — Canonical Feature cohort 07** — `TODO`
- [ ] **FA-077 — Canonical Feature cohort 08** — `TODO`
- [ ] **FA-078 — Canonical Feature cohort 09** — `TODO`
- [ ] **FA-079 — Canonical Feature cohort 10** — `TODO`
- [ ] **FA-080 — Canonical Feature cohort 11** — `TODO`
- [ ] **FA-081 — Canonical Feature cohort 12** — `TODO`
- [ ] **FA-082 — Canonical Feature cohort 13** — `TODO`
- [ ] **FA-083 — Canonical Feature cohort 14** — `TODO`
- [ ] **FA-084 — Canonical Feature cohort 15** — `TODO`
- [ ] **FA-085 — Canonical Feature cohort 16** — `TODO`
- [ ] **FA-086 — Canonical Feature cohort 17** — `TODO`
- [ ] **FA-087 — Canonical Feature cohort 18** — `TODO`
- [ ] **FA-088 — Canonical Feature cohort 19** — `TODO`
- [ ] **FA-089 — Canonical Feature cohort 20** — `TODO`
- [ ] **FA-090 — Canonical Feature cohort 21** — `TODO`
- [ ] **FA-091 — Canonical Feature cohort 22** — `TODO`
- [ ] **FA-092 — Canonical Feature cohort 23** — `TODO`
- [ ] **FA-093 — Canonical Feature cohort 24** — `TODO`
- [ ] **FA-094 — Canonical Feature cohort 25** — `TODO`
- [ ] **FA-095 — Canonical Feature cohort 26** — `TODO`
- [ ] **FA-096 — Canonical Feature cohort 27** — `TODO`
- [ ] **FA-097 — Canonical Feature cohort 28** — `TODO`
- [ ] **FA-098 — Canonical Feature cohort 29** — `TODO`
- [ ] **FA-099 — Canonical Feature cohort 30 and cross-source closure audit** — `TODO`

### Phase 9 — Whole-catalog certification, migration, and release

- [ ] **FA-100 — Enforce strict frozen-row semantic closure** — `TODO`
- [ ] **FA-101 — Run whole-catalog conformance and property suites** — `TODO`
- [ ] **FA-102 — Certify Move, Maneuver, Ability, Capability, and Edge interactions** — `TODO`
- [ ] **FA-103 — Certify Item, inventory, capture, shop, and campaign interactions** — `TODO`
- [ ] **FA-104 — Certify class, branch, rank, prerequisite, grant, and retraining graphs** — `TODO`
- [ ] **FA-105 — Shadow and migrate existing Orders, Training, and Feature-derived behaviour** — `TODO`
- [ ] **FA-106 — Complete security, privacy, backup, restart, and recovery validation** — `TODO`
- [ ] **FA-107 — Enforce catalog-scale offer, provider, trigger, and graph performance budgets** — `TODO`
- [ ] **FA-108 — Complete contributor, operator, build-validation, and manual-QA documentation** — `TODO`
- [ ] **FA-109 — Run production-like multi-client, progression, encounter, and downtime acceptance** — `TODO`
- [ ] **FA-110 — Retire legacy Feature execution and record final automation acceptance** — `TODO`
  - Require all Feature checks, typecheck, tests, build, `scripts/quality-gate.sh`, zero undocumented semantic debt, and then unblock `ENCOUNTER_UI_UX_PLAN.md`.

## Decision log

- **2026-07-26 — Feature automation follows Edge automation.** Features grant, require, replace, or modify Edges and Capabilities; those contracts must already be stable.
- **2026-07-26 — Source repair is a release blocker.** The current large parser output cannot be treated as canonical mechanics until class context, merged prose, errata, and ranked blocks are source-hash audited.
- **2026-07-26 — Preserve class structure without making class structure the UI.** Class, Branch, Ranked, Orders, and other tags remain rules metadata; the generic action and resolution surfaces present what the user can do.
- **2026-07-26 — Treat AP as an authoritative cross-feature resource.** Bind, Drain, temporary AP, nested payment, and recovery must be atomic and replay-safe.
- **2026-07-26 — Treat downtime and non-combat Features as real product workflows.** Crafting, medicine, research, training, capture, travel, social, and contest mechanics are implemented through campaign operations or typed adjudication.
