# Capability Automation Implementation Plan

`PLAN_STATUS: DONE`

`CURRENT_TICKET: NONE`

`BLOCKED_BY: AUTOMATION_PRESENTATION_CONTRACT_PLAN.md — PLAN_STATUS: DONE`

## Goal

Implement complete, server-authoritative automation for every canonical capability in `data/reference/capabilities.json`, including numeric movement capabilities, passive physical and sensory facts, activated combat capabilities, struggle modifications, forms, mounts, fusion, communication, crafting, gathering, item production, campaign-time effects, and rules that require bounded GM adjudication.

A capability may describe what a participant **is**, what it **can do**, what it **changes in another action**, or what it **can do only in a particular environment**. The implementation must preserve those distinctions. Completing this plan must not produce a universal “Use Capability” menu.

This file is the durable implementation ledger for capability automation. It begins only after the generic automation presentation contract is accepted.

## Canonical scope and baseline

- Canonical reference source: `data/reference/capabilities.json`
- Current Git blob SHA at plan creation: `8d89cc293797ad9fb77d8f6f1b5840146b1e871b`
- Source parser: `ptu-data/parse_capabilities.py`
- Source hierarchy currently includes supplement references, errata, core capability reference text, playing-the-game numeric capability rules, and character-creation Jump rules.
- Canonical count, SHA-256, identity order, source-byte hashes, missing-field inventory, and parser adjudications must be frozen by CA-001 through CA-003 before semantic implementation begins.
- Current sheet inputs include:
  - Pokémon species defaults plus sheet overrides;
  - Trainer numeric capability fields plus free-form `other` capabilities;
  - move-granted capability bonuses and grants;
  - temporary encounter capability effects;
  - ability-owned capability changes, forms, mounts, and transformations.
- The catalog includes parameterised identities such as valued movement capabilities, `Mountable X`, `Naturewalk (...)`, and other source-authored values. Base identity and instance parameters must be separated.
- Existing helpers, movement queries, and exact-name checks are migration inputs only. They do not prove catalog completion.
- Trainer and Pokémon ownership, sheet persistence, encounter overlays, and campaign-time state must remain distinct authorities.

## Non-negotiable rules

1. **Every canonical row is in scope.** Narrative, species-specific, out-of-combat, GM-facing, weekly, crafting, form, or environment-dependent capabilities are not excluded.
2. **No runtime prose interpretation.** Canonical text is reviewed into strict specs, parameters, handlers, or adjudication contracts.
3. **Capabilities are not all actions.** Passive facts, numeric values, derived providers, contextual affordances, triggers, and declarations remain separate roles.
4. **One effective projection.** Base species, sheet overrides, move grants, abilities, features, edges, items, forms, transformations, suppression, and encounter effects resolve in deterministic order.
5. **Values are typed.** Movement, Power, Jump, range, capacity, Naturewalk terrains, mount capacity, durations, and production limits are not stored as unparsed labels.
6. **Server authority applies everywhere.** Combat, training, crafting, gathering, time advancement, and GM-adjudicated results are validated and committed by the server.
7. **Explicit judgement is typed.** When canonical rules genuinely delegate a decision to the GM, use a bounded authorised adjudication offer and retain the accepted choice; never hide it as a “manual step.”
8. **Time is authoritative.** Daily, weekly, hourly, 24-hour, two-week, cooldown, and rest-bound effects use explicit campaign lifecycle identities and exact retry semantics.
9. **Spatial rules use authoritative geometry.** Movement, reach, phasing, wall travel, teleportation, mounting, carried entities, and occupancy never trust browser coordinates.
10. **Persistent and temporary state stay separate.** Lasting capability facts belong to sheets/campaign resources; temporary modes and scene state belong to encounter state; suspended choices belong to pending storage.
11. **Privacy and senses matter.** Telepathy, tracking, X-ray vision, hidden participants, illusions, and GM-only facts use authorised projections.
12. **Generic presentation only.** Capability actions, passives, choices, reasons, and outcomes use the accepted automation presentation contract.
13. **Interaction honesty.** Base capability completion and interactions with Moves, Abilities, Edges, Features, Items, terrain, forms, and campaign systems are separately certified.
14. **Production changes flow through GitHub.** Do not mutate deployed runtime or private campaign data directly.

## Semantic completion contract

A capability row may be marked `complete` only when all applicable clauses satisfy the following:

- canonical identity, aliases, parameters, ownership, prerequisites, action cost, frequency, trigger, target, range, duration, reset, and source provenance are encoded;
- the effective capability projection deterministically resolves base, override, grant, bonus, replace, suppress, copy, form, mount, fusion, and source-loss behaviour;
- passive effects automatically influence every owning query and cannot be invoked as actions;
- activated capabilities validate actor control, current effective capability, costs, timing, targets, geometry, environment, and instance parameters on the server;
- contextual capabilities expose affordances only when the authoritative context makes them legal;
- campaign operations validate time, location, tools, inventory, loyalty, level, skills, and persistent resources where applicable;
- randomness and checks are server-owned, injected for tests, bounded, and retained in a replay-safe ledger;
- GM discretion uses a typed, authorised, bounded choice with exact resume and audit behaviour;
- all consulted map, sheet, inventory, shop, campaign-time, object, and encounter resources join the read set;
- all writes commit atomically or through an explicit durable saga;
- reconnect, retry, stale conflicts, cancellation, expiry, abandonment, recovery, and lifecycle cleanup are tested where applicable;
- executable scenarios cover every branch, cap, prevention, no-op, relation, environment, source-loss, and interaction required by the capability’s own text;
- the manifest points to a reviewed runtime/hash/source and has no blocker, limitation, hidden exclusion, or prose-only mechanic;
- public and authorised presentation use generic contracts and do not determine outcomes.

## Target architecture

```text
canonical capability catalog
  -> frozen capability ruleset + strict semantic manifest
  -> typed CapabilityInstanceData
  -> effective capability projection
  -> passive provider / contextual affordance / CapabilitySpec v1 declaration
  -> authoritative capability context and shared mechanical kernel
  -> complete read-set state plan
  -> atomic commit or durable pending/adjudication saga
  -> generic accepted presentation and explanation
```

Capability ownership layers:

```text
species and trainer baselines
  + sheet-authored overrides and instance parameters
  + permanent move / feature / edge / item grants
  + effective ability and form projections
  + temporary encounter capability effects
  - active suppressions and replacements
  = authoritative effective capability view
```

## Capability role model

Every canonical capability must be assigned one or more closed roles:

- `numeric-capability`
- `passive-physical-fact`
- `passive-sensory-fact`
- `passive-rule-provider`
- `activated-action`
- `contextual-affordance`
- `triggered-effect`
- `movement-mode`
- `form-or-mode`
- `mount-fusion-or-carried-entity`
- `item-production-or-crafting`
- `campaign-time-operation`
- `communication-or-information`
- `gm-adjudicated`
- `classification-only`

Classification-only rows still require authoritative projection and interaction evidence; they are not automatically “manual.”

## Versioning, identity, and instance policy

- Canonical IDs derive from frozen source-key identity and a versioned canonicalization policy.
- Parameterised labels are parsed only at import/normalization boundaries into strict instance data.
- Store stable base capability IDs plus typed values/choices; display labels are projections.
- Existing free-form sheet labels remain readable through explicit compatibility normalizers, but accepted writes emit canonical instance data.
- Unknown capability names or malformed values remain visible for maintenance but never enter authoritative mechanics.
- Definition hashes bind specs and handlers to the frozen capability ruleset and reviewed source bytes.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless the decision log records a safe parallel track.
- Mark a ticket `DONE` only after focused tests and all applicable capability checkers pass.
- CA-006 must replace cohort range placeholders with exact frozen member lists before CA-070 starts.
- Newly discovered reusable machinery belongs to the earliest unfinished owning ticket; if none remains, add a narrowly scoped ticket before implementation.
- Update the progress snapshot from checker output after every canonical cohort.
- Set `PLAN_STATUS: DONE` only after every frozen row is complete, interaction certification is complete, legacy production mechanics are retired, and `scripts/quality-gate.sh` passes.

## Progress snapshot

- Plan tickets: **90 DONE / 90 total**
- Frozen canonical inventory: **83 rows; Git blob `8d89cc293797ad9fb77d8f6f1b5840146b1e871b`; SHA-256 `8f819401d40c598ae781ae0b273fd749575e05d6997a79c64be61f4ced8f654e`**
- Complete capability rows: **83**
- Assisted rows: **0**
- Blocked/unimplemented rows: **0**
- Reviewed executable scenarios: **162**
- Interaction status: **certified across Moves, Maneuvers, Abilities, encounter effects, Items, inventory, campaign time, Edges, and Features**
- Effective projection version: **1**
- Production runtime: **server-authoritative native v1; legacy capability execution disallowed**
- Closure validation: **`scripts/quality-gate.sh` passed; 1,127 Vitest files / 8,851 tests and the production build succeeded**
- Blocking dependency: **none — automation presentation contract accepted and archived under `implementation-plans/done/`**

## Tickets

### Phase 1 — Governance, provenance, and honest inventory

- [x] **CA-001 — Freeze the canonical capability inventory and SHA-256** — `DONE`
  - Record exact count, IDs, Unicode order, source fields, source-byte hashes, and the current app-owned JSON digest.
- [x] **CA-002 — Audit parser boundaries, duplicates, and source precedence** — `DONE`
  - Review supplement/core shadowing, missing rows, merged prose, malformed values, aliases, and extraction artifacts.
- [x] **CA-003 — Add source adjudications for every catalog gap** — `DONE`
  - Bind reviewed corrections to exact checked-in source paths, anchors, and hashes; fail on source drift.
- [x] **CA-004 — Define the capability semantic manifest** — `DONE`
  - Track base status, roles, parameters, runtime, provenance, dependencies, interactions, evidence, debt, review date, and cohort.
- [x] **CA-005 — Define capability requirement, evidence, and dependency catalogs** — `DONE`
- [x] **CA-006 — Add deterministic manifest/cohort seeders** — `DONE`
  - Populate one row per frozen capability and write exact canonical names into CA-070 through CA-079.
- [x] **CA-007 — Add coverage, completeness, link, budget, and plan checks** — `DONE`
- [x] **CA-008 — Record the authoritative capability ADR and contributor guide** — `DONE`
- [x] **CA-009 — Produce a reviewed baseline audit of existing capability behaviour** — `DONE`
  - Map sheet derivation, movement queries, move grants, abilities, exact-name hooks, UI fields, and missing runtime semantics without pre-completing rows.

### Phase 2 — Identity, instances, and effective capability projection

- [x] **CA-010 — Define strict canonical capability IDs and aliases** — `DONE`
- [x] **CA-011 — Define `CapabilityInstanceData` and parameter schemas** — `DONE`
  - Cover numeric values, Jump pairs, Naturewalk terrains, capacities, types, forms, object references, and reviewed choices.
- [x] **CA-012 — Migrate Pokémon and Trainer sheet capability storage** — `DONE`
  - Preserve legacy labels through compatibility readers while emitting canonical instance data on accepted writes.
- [x] **CA-013 — Normalize species defaults and trainer baselines** — `DONE`
- [x] **CA-014 — Integrate move-granted capability additions and bonuses** — `DONE`
  - Replace production prose parsing with reviewed move metadata or manifest-linked grants.
- [x] **CA-015 — Integrate ability-, feature-, edge-, item-, and form-owned grants** — `DONE`
  - Provide stable source references even before later catalogs are fully automated.
- [x] **CA-016 — Define deterministic stacking, replacement, and suppression** — `DONE`
- [x] **CA-017 — Define effective valued-capability calculations** — `DONE`
  - Cover floors, caps, substitutions, additive bonuses, highest-value rules, and source evidence.
- [x] **CA-018 — Define capability source-loss and lifecycle cleanup** — `DONE`
- [x] **CA-019 — Add strict projection parsers, fixtures, and property tests** — `DONE`

### Phase 3 — Capability runtime, planning, resources, and state ownership

- [x] **CA-020 — Define strict `CapabilitySpec v1`** — `DONE`
  - Reuse the shared mechanical kernel while keeping capability identity, context, time, and ownership explicit.
- [x] **CA-021 — Add spec normalization, validation, hashing, and registry** — `DONE`
- [x] **CA-022 — Add a bounded pure capability-handler registry** — `DONE`
- [x] **CA-023 — Build immutable authoritative capability context** — `DONE`
- [x] **CA-024 — Add capability trace, roll ledger, and causal ancestry** — `DONE`
- [x] **CA-025 — Add complete read-set and atomic state-plan integration** — `DONE`
- [x] **CA-026 — Add capability usage ledgers** — `DONE`
  - Support encounter, scene, day, 24-hour, week, per-target, per-environment, and one-time limits.
- [x] **CA-027 — Add campaign clock and lifecycle identities required by capabilities** — `DONE`
  - Define explicit GM-owned day/week advancement, timestamps where required, rest events, and replay-safe resets.
- [x] **CA-028 — Add durable capability choices and GM adjudication windows** — `DONE`
- [x] **CA-029 — Add restart, backup, export, retry, and recovery semantics** — `DONE`

### Phase 4 — Movement, geometry, terrain, and physical capability rules

- [x] **CA-030 — Complete Overland, Sky, Swim, Levitate, Burrow, Teleporter, and Jump queries** — `DONE`
- [x] **CA-031 — Complete Power, Throwing Range, carrying, lifting, and capacity queries** — `DONE`
- [x] **CA-032 — Complete grounding, airborne state, height, surfaces, and movement-mode switching** — `DONE`
- [x] **CA-033 — Complete Naturewalk, slow/rough terrain, water, walls, ceilings, and phasing traversal** — `DONE`
- [x] **CA-034 — Complete Reach, Threaded, Wallclimber, and special movement actions** — `DONE`
- [x] **CA-035 — Complete teleport, warp, wired travel, and line-of-sight destination rules** — `DONE`
- [x] **CA-036 — Complete size, weight, blocking, shrink, inflate, and occupancy projections** — `DONE`
- [x] **CA-037 — Complete mounts, riders, carried entities, shared movement, and dismount rules** — `DONE`
- [x] **CA-038 — Complete living weapons, wielders, equipment occupancy, and shared-turn movement** — `DONE`
- [x] **CA-039 — Add authoritative geometry, pathfinding, interruption, and multi-client tests** — `DONE`

### Phase 5 — Senses, communication, forms, information, and exceptional entities

- [x] **CA-040 — Complete vision, darkness, blindsense, tremorsense, X-ray, and blindness interactions** — `DONE`
- [x] **CA-041 — Complete telepathy, aura, dream, mindlock, and opposed-information checks** — `DONE`
- [x] **CA-042 — Complete tracking, scent, disaster sense, magnetic sense, and environmental information** — `DONE`
- [x] **CA-043 — Complete invisibility, shadow meld, illusion, shapeshift, disguise, and reveal rules** — `DONE`
- [x] **CA-044 — Complete weather-linked and species-linked form projections** — `DONE`
- [x] **CA-045 — Complete fusion, bonding, combined Pokémon, shared capture, and source snapshots** — `DONE`
- [x] **CA-046 — Complete subordinate entities, summoned creatures, anchors, plants, and generated objects** — `DONE`
- [x] **CA-047 — Complete classification capabilities and class/feature eligibility queries** — `DONE`
- [x] **CA-048 — Add private-information redaction and authorised reveal presentation** — `DONE`
- [x] **CA-049 — Add lifecycle, source-loss, capture, faint, recall, and separation tests** — `DONE`

### Phase 6 — Combat providers, struggle changes, production, and campaign operations

- [x] **CA-050 — Complete typed Struggle substitutions and type/class choices** — `DONE`
- [x] **CA-051 — Complete Accuracy, Evasion, critical, targeting, immunity, and defensive providers** — `DONE`
- [x] **CA-052 — Complete move grants, move-list overlays, ability grants, and connection rules** — `DONE`
- [x] **CA-053 — Complete condition, loyalty, injury, HP, temporary HP, and fainting providers** — `DONE`
- [x] **CA-054 — Complete crafting, planting, harvesting, grooming, and tool requirements** — `DONE`
- [x] **CA-055 — Complete item and money production with inventory capacity and provenance** — `DONE`
  - Cover daily/weekly products, random tables, collection containers, and atomic inventory writes.
- [x] **CA-056 — Complete eggs, evolution, berries, timed conversion, and long-duration campaign state** — `DONE`
- [x] **CA-057 — Complete training, tutoring, experience transfer, loyalty, and level gates** — `DONE`
- [x] **CA-058 — Complete city, wilderness, camp, machine, and environment-dependent affordances** — `DONE`
- [x] **CA-059 — Add campaign-operation authorization, audit, rollback, and recovery tests** — `DONE`

### Phase 7 — Generic UX contract, observability, and integration boundaries

- [x] **CA-060 — Project capability passives and effective facts through the generic contract** — `DONE`
- [x] **CA-061 — Project activated and contextual capability offers** — `DONE`
- [x] **CA-062 — Project choices, adjudications, pending interactions, and accepted facts** — `DONE`
- [x] **CA-063 — Add capability contribution explanations and unavailable reasons** — `DONE`
- [x] **CA-064 — Integrate capability changes with snapshots, realtime, and reconciliation** — `DONE`
- [x] **CA-065 — Integrate capability state with sheet and encounter inspectors** — `DONE`
- [x] **CA-066 — Add bounded diagnostics, metrics, and audit reports** — `DONE`
- [x] **CA-067 — Complete authorization, privacy, malformed-input, and abuse testing** — `DONE`
- [x] **CA-068 — Enforce capability-scale performance budgets** — `DONE`
- [x] **CA-069 — Remove production reliance on exact-name capability hooks and browser mechanics** — `DONE`

### Phase 8 — Canonical capability cohorts

Each cohort must review every frozen row in the named identity range against canonical source text, implement every required role and branch, register reviewed runtime/projection metadata, add executable evidence, and promote only genuinely complete rows. CA-006 replaces each range with the exact member list before this phase begins.

- [x] **CA-070 — Canonical capabilities A–B** — `DONE`
  - Exact members: `Alluring`, `Amorphous`, `As One`, `Aura Pulse`, `Aura Reader`, `Blender`, `Blindsense`, `Bloom`, `Burrow`.
- [x] **CA-071 — Canonical capabilities C–D** — `DONE`
  - Exact members: `Chilled`, `Darkvision`, `Dead Silent`, `Delta Evolution`, `Dream Mist`, `Dream Reader`.
- [x] **CA-072 — Canonical capabilities E–G** — `DONE`
  - Exact members: `Egg Warmer`, `Firestarter`, `Fortune`, `Fountain`, `Freezer`, `Gather Unown`, `Gilled`, `Glow`, `Groundshaper`, `Guster`.
- [x] **CA-073 — Canonical capabilities H–J** — `DONE`
  - Exact members: `Heart Gift`, `Heater`, `Herb Growth`, `High Jump`, `Honey Gather`, `Illusionist`, `Inflatable`, `Invisibility`, `Juicer`, `Jump`.
- [x] **CA-074 — Canonical capabilities K–M** — `DONE`
  - Exact members: `Keystone Warp`, `Letter Press`, `Levitate`, `Living Weapon`, `Long Jump`, `Magnetic`, `Marsupial`, `Materializer`, `Milk Collection`, `Mindlock`, `Mountable X`, `Mushroom Harvest`.
- [x] **CA-075 — Canonical capabilities N–P** — `DONE`
  - Exact members: `Naturewalk`, `Overland`, `Pack Mon`, `Pearl Creation`, `Phasing`, `Planter`, `Power`, `Premonition`.
- [x] **CA-076 — Canonical capabilities Q–S** — `DONE`
  - Exact members: `Reach`, `Shadow Meld`, `Shapeshifter`, `Shrinkable`, `Sky`, `Soulless`, `Split Evolution`, `Sprouter`, `Stealth`, `Swim`.
- [x] **CA-077 — Canonical capabilities T–V** — `DONE`
  - Exact members: `Telekinetic`, `Telepath`, `Teleporter`, `Threaded`, `Throwing Range`, `Tracker`, `Tremorsense`, `Underdog`, `Viral Fusion`, `Volatile Bomb`.
- [x] **CA-078 — Canonical capabilities W–Z** — `DONE`
  - Exact members: `Wallclimber`, `Weapon Bond`, `Weathershape`, `Wielder`, `Wired`, `X-Ray Vision`, `Zapper`, `Zygarde Cells`.
- [x] **CA-079 — Supplemental, parameterised, and cross-source closure audit** — `DONE`
  - Prove that source ordering, valued instances, species-specific entries, and core numeric capabilities are all present exactly once.

### Phase 9 — Whole-catalog certification, migration, and release

- [x] **CA-080 — Enforce strict frozen-row semantic closure** — `DONE`
- [x] **CA-081 — Run whole-catalog conformance and property suites** — `DONE`
- [x] **CA-082 — Certify Move and Maneuver interactions** — `DONE`
- [x] **CA-083 — Certify Ability and encounter-effect interactions** — `DONE`
- [x] **CA-084 — Certify Item, inventory, crafting, and campaign-time interactions** — `DONE`
- [x] **CA-085 — Certify Edge and Feature integration seams** — `DONE`
  - Record stable contracts required by the queued catalogs without falsely claiming their own semantic completion.
- [x] **CA-086 — Shadow and migrate existing capability behaviour** — `DONE`
- [x] **CA-087 — Complete security, privacy, backup, restart, and recovery validation** — `DONE`
- [x] **CA-088 — Complete contributor, operator, and manual-QA documentation** — `DONE`
- [x] **CA-089 — Run production-like multi-client and campaign acceptance** — `DONE`
- [x] **CA-090 — Retire legacy production capability execution and record release acceptance** — `DONE`
  - Require all capability checks, typecheck, tests, build, `scripts/quality-gate.sh`, and zero undocumented manual mechanics.

## Decision log

- **2026-07-26 — Capabilities follow the generic presentation contract.** The catalog must not create a second source-specific UI/command architecture after Ability automation.
- **2026-07-26 — Effective capability projection is the central product.** Numeric, passive, granted, suppressed, transformed, and temporary capabilities resolve through one authoritative view.
- **2026-07-26 — Out-of-combat capabilities are first-class automation.** Crafting, gathering, production, training, time, and environment rules require server-owned operations rather than being dismissed as narrative-only.
- **2026-07-26 — Canonical GM discretion becomes typed adjudication.** The server constrains eligible actors, option kinds, persistence, and resume; the authorised GM supplies only the judgement the source genuinely delegates.
- **2026-07-26 — Legacy labels remain compatibility input, not mechanics state.** Accepted writes move toward stable capability IDs and typed instance parameters.
- **2026-07-30 — Closure certification passed.** Focused serialized authority/privacy regressions, the complete quality gate, and the production build passed with all 83 canonical rows native and no manual or legacy execution path.
