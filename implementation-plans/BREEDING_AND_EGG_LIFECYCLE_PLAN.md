# Breeding and Egg Lifecycle Implementation Plan

`PLAN_STATUS: QUEUED`

`CURRENT_TICKET: BR-001`

`BLOCKED_BY: ENCOUNTER_UI_UX_PLAN.md — PLAN_STATUS: DONE`

`UPSTREAM_CONTRACTS: EDGE_AUTOMATION_PLAN.md, FEATURE_AUTOMATION_PLAN.md, AUTOMATION_PRESENTATION_CONTRACT_PLAN.md`

`DESIGN_AUTHORITY: DESIGN.md`

## Goal

Implement a complete, server-authoritative breeding and Egg lifecycle for Rotom Table as a first-class campaign workflow.

The finished system must validate compatible parents and authorised breeders, run the PTU breeding timeline and checks, resolve offspring species and traits, freeze inheritance provenance, persist a durable Egg, advance incubation, hatch exactly once, create a complete Pokémon sheet atomically, link the child to the correct Trainer, and record first-species ownership rewards. It must support canonical Breeder-driven production, explicit GM intervention, fossil-created Eggs, mysterious or campaign-authored Eggs, and future Feature, Edge, item, and facility modifiers without turning editable sheet fields into mechanic authority.

Breeding is a **campaign operation with a Workshop presentation**, not an encounter action and not a map-scoped live-play command. Eggs are durable campaign entities that exist before a child Pokémon sheet exists.

This file is the durable implementation ledger for breeding, Egg persistence, incubation, and hatching. It begins after the existing implementation-plan chain so that Edge and Feature providers, the generic automation presentation contract, the encounter/workshop design system, browser acceptance infrastructure, and role-specific privacy projections are already stable.

## Product outcome

The completed product provides:

- a first-class Breeding Workshop associated with Trainers and their authorised Pokémon;
- explainable parent compatibility and unavailable reasons;
- durable multi-session breeding projects for the initial time, check, and completion period;
- replay-safe server-owned rolls and rank-authorised trait choices;
- a versioned, immutable offspring blueprint stored on a durable Egg;
- campaign-clock and explicit GM-ready incubation paths;
- atomic, exactly-once hatching into a complete level-appropriate Pokémon sheet;
- lineage and inheritance provenance that survives parent evolution, trade, rename, or deletion;
- owner, participant, public, GM, and diagnostic privacy projections;
- consent and control rules for cross-owner parents;
- shared Egg production and hatching infrastructure for fossils and campaign-authored Eggs;
- first-species acquisition history shared by capture, hatch, and evolution;
- backup, export, restore, reconnect, recovery, and concurrency safety;
- accessible, responsive, keyboard-operable Workshop flows consistent with `DESIGN.md`.

## Canonical scope and baseline

### Canonical rules sources

The frozen source inventory must include, at minimum:

- `books/markdown/core/05-pokemon.md` breeding, loyalty, fossil, and capture-adjacent rules;
- `books/markdown/pokedexes/how-to-read.md` breeding information, Egg Groups, hatch rates, and inheritance guidance;
- `books/markdown/core/03-skills-edges-and-features.md` and `data/reference/edges.json` for the canonical `Breeder` Edge;
- applicable errata affecting tutoring and inheritance prerequisites;
- `data/reference/pokedex.json` for gender ratios, basic Abilities, evolution families, Egg Groups, hatch rates, Egg Moves, and TM/HM compatibility;
- `data/reference/moves.json`, `data/reference/abilities.json`, and the canonical identity registries produced by the automation plans;
- canonical Feature, Edge, item, capability, and campaign-operation definitions that can modify breeding, incubation, or hatching.

BR-001 through BR-009 freeze exact source paths, source-byte hashes, parser versions, rule conflicts, adjudications, and campaign-option defaults before mechanics implementation.

### Existing data inputs

- `PokedexRecord` already exposes `genderless`, `male_pct`, `female_pct`, `evolutions`, `egg_groups`, `hatch_rate`, `abilities`, `egg_moves`, and `tm_hm_moves`.
- `CharacterSheet` already permits egg-group overrides and stores editable `eggMoves`, `inheritedMoves`, Nature, Gender, Abilities, and other child-facing fields.
- The Pokémon generator contains useful inheritance-slot and move-prerequisite logic, but it is wild-generation support rather than a durable, authoritative breeding workflow.
- Trainer sheets link active and boxed Pokémon by Pokémon sheet slug and enforce a normal active-team limit. There is no Egg roster.
- SQLite is the sole runtime authority for maps, sheets, inventories, shops, and operation results, but there is no breeding-project or Egg table at plan creation.
- There is no complete campaign clock that can authoritatively advance eight-hour breeding projects and species hatch durations.
- Existing sheet creation produces a default blank sheet; hatching needs atomic creation of an already-initialised child document.
- Existing `dexExp`-style totals do not establish durable historical ownership of a species after trade, release, deletion, or evolution.
- Existing editable `eggMoves` and `inheritedMoves` are compatibility inputs only. They do not prove parentage, rolls, source revisions, or inheritance eligibility.

### Upstream ownership boundary

`EDGE_AUTOMATION_PLAN.md` owns:

- canonical `Breeder` identity and prerequisites;
- effective Edge ownership and suppression;
- Pokémon Education contribution evidence;
- the typed permission to request a breeding campaign operation;
- the generic offer, unavailable-reason, and contribution projection seam.

This plan owns:

- compatibility and maturity adjudication;
- parent consent, control, and snapshots;
- breeding-project time and checks;
- offspring species, Nature, Ability, Gender, and special-result resolution;
- inheritance construction and provenance;
- Egg persistence, transfer, incubation, readiness, and hatching;
- child-sheet creation, Trainer linkage, lineage, and species-acquisition history;
- every downstream operation, transaction, event, recovery path, and Workshop surface.

No plan may duplicate ownership across that boundary.

## Canonical rule conflicts requiring adjudication

The checked-in sources contain decisions that cannot be left to runtime inference:

- the core breeding procedure selects the female parent’s species on a d20 result of 5 or higher and the male parent’s species on 4 or lower;
- the Pokédex guide describes the baby as the lowest form of the mother’s evolutionary line;
- Ditto can act in either parent role and has a unique Egg Group;
- some Pokémon are genderless, have unusual form families, or have incomplete or contradictory source data;
- “mature enough” is not expressed as one universal machine-readable threshold;
- the hatch-rate text is descriptive and may allow half-to-double variation;
- a hatch roll of 1 or 100 makes the Pokémon special in a GM-determined way rather than necessarily setting `shiny: true`;
- the optional Baby Template changes Base Stats, Skills, Capabilities, size, and growth;
- fossils produce Eggs but hatch at a different starting Level;
- inheritance prerequisites from errata can leave an earlier inheritance slot empty.

BR-002 records one versioned default ruleset and typed campaign overrides. Every Egg stores the ruleset ID and definition hash that resolved it.

## Non-negotiable rules

1. **An Egg is a first-class aggregate.** It is not a Pokémon sheet, inventory row, token, status condition, or Trainer roster slug.
2. **No third sheet kind.** Pokémon and Trainer sheet assumptions remain intact; Eggs use dedicated repositories and projections.
3. **One authoritative owner per fact.** Edge permission, project state, Egg state, child-sheet state, and campaign history never have competing writers.
4. **No runtime prose interpretation.** Source text is compiled into strict versioned specs, adjudications, choices, and handlers.
5. **Canonical IDs, not labels.** Species, families, moves, Abilities, Egg Groups, traits, options, and sources use stable identities.
6. **Rules are frozen on production.** Every project and Egg records the ruleset, source definition hashes, and accepted campaign options used.
7. **Parents are revisioned snapshots.** Species, form/family, Gender, effective Egg Groups, effective known Moves, ownership, and relevant providers are frozen when required by the canonical checkpoint.
8. **Accepted Eggs do not drift.** Parent learning, evolution, trade, rename, deletion, source updates, or campaign override changes do not retroactively rewrite an Egg.
9. **All randomness is server-owned.** Parent-family, Nature, Ability, Gender, check, hatch-special, duration, and modifier rolls use a replay-safe ledger.
10. **Rank-authorised choices are bounded.** Clients submit server-issued option IDs; they never submit executable values, patches, or arbitrary source text.
11. **Exact retry is mandatory.** Reconnect and duplicate submission reuse the same checks, rolls, choices, spends, project, Egg, and child.
12. **Hatching is atomic and exactly once.** Egg transition, child creation, Trainer linkage, acquisition history, rewards, events, and terminal operation result commit together.
13. **No placeholder child.** The child sheet is inserted fully initialised; a blank sheet followed by a second save is not an accepted hatch path.
14. **Inheritance is frozen and provenance-bound.** Every eligible move records parent and pathway evidence; display-name coincidence is not mechanic identity.
15. **Eggs do not consume active-team slots.** They remain outside `currentTeam` and `boxedPokemon` until hatching.
16. **Consent is explicit.** Cross-owner parents require authorised positive consent or a recorded GM override; browser selection is not permission.
17. **Privacy is structural.** Public, owner, participating owner, GM, and diagnostic views are separate schemas.
18. **Special does not mean automatically Shiny.** The 1-or-100 hatch result opens a bounded GM decision unless the frozen campaign ruleset defines a deterministic outcome.
19. **Campaign time is authoritative.** Project and incubation progress uses a versioned campaign clock or an explicitly audited GM advancement path.
20. **Workshop, not battlefield.** Normal breeding and hatching do not depend on a map, placement, initiative, or live-play interaction mode.
21. **Upstream providers are consulted, not copied.** Effective Edge, Feature, item, facility, and capability contributions join the read set and are snapshotted only at their reviewed checkpoints.
22. **Fossils reuse the Egg lifecycle.** They may alter source kind, starting Level, inheritance, or timing but do not create a parallel hatch implementation.
23. **Legacy fields are adapters only.** Editable `eggMoves` and `inheritedMoves` cannot manufacture lineage or satisfy authoritative provenance.
24. **Exports and restores preserve identity.** Project, Egg, roll, operation, consent, lineage, and child links survive backup and import without rerolling.
25. **Accessibility is a release requirement.** Compatibility reasons, choices, progress, consent, and hatch results work by keyboard, screen reader, touch, zoom, and reduced motion.

## Semantic completion contract

Breeding may be marked complete only when all applicable clauses satisfy the following:

- canonical rules, conflicts, errata, campaign options, aliases, source hashes, and definition versions are frozen;
- every referenced species has a valid breeding spec or an explicit source-bound adjudication;
- evolution-family roots, forms, branches, Egg Groups, gender policies, basic Abilities, hatch duration, Egg Moves, and machine compatibility resolve deterministically;
- compatibility, maturity, Ditto, genderless, same-owner, cross-owner, GM-intervention, and no-breeding cases fail closed with stable reasons;
- all breeder permissions and Feature/Edge/item/facility contributions use authoritative effective projections;
- projects persist across process restart, reconnect, session boundaries, and campaign-clock advancement;
- the initial time, check, additional time, cancellation, expiry, abandonment, and recovery semantics are explicit;
- offspring species, Nature, Ability, Gender, inheritance, and campaign options are frozen before or on Egg creation at reviewed checkpoints;
- every random or checked result has stable identity, inputs, output, source, and retry evidence;
- Eggs are independent documents with versioned lifecycle states and no hidden sheet or inventory authority;
- incubation is deterministic under manual and campaign-clock advancement and cannot double-apply time;
- hatching creates exactly one complete child sheet and one terminal Egg result;
- lineage, inheritance candidates, learned inheritance slots, special outcome, source kind, and parent evidence survive on the child;
- Trainer linkage and first-species acquisition rewards are transactional and historically correct;
- parent changes after Egg production cannot corrupt or rewrite accepted Egg facts;
- public, owner, participating-owner, GM, and diagnostic projections reveal only authorised information;
- realtime, snapshots, reconnect, replay gaps, exact retry, conflict, cancellation, abandonment, and recovery converge;
- import/export, backup/restore, migration, and source-version changes preserve accepted outcomes;
- focused unit, property, repository, integration, Nuxt, browser, accessibility, concurrency, and failure-injection suites pass;
- legacy manual breeding authority is retired and no production path claims success by merely editing sheet fields;
- `scripts/quality-gate.sh` and production-like acceptance pass.

## Target architecture

```text
canonical PTU sources + campaign rule options
  -> frozen breeding source manifest and adjudications
  -> compiled BreedingSpeciesSpec registry
  -> effective Edge / Feature / item / facility providers
  -> authorised breeding preview and typed choices
  -> durable BreedingProject
  -> server-owned checks, rolls, snapshots, and state plan
  -> durable PokemonEgg offspring blueprint
  -> campaign-clock or audited manual incubation
  -> exactly-once hatch transaction
  -> complete Pokémon sheet + Trainer link + acquisition history
  -> role-specific presentation, realtime, backup, and recovery
```

### Breeding project lifecycle

```text
draft
  -> awaiting-parent-consent
  -> initial-time-in-progress
  -> check-ready
  -> additional-time-in-progress
  -> ready-to-produce
  -> egg-produced
```

Terminal project states:

```text
cancelled | expired | abandoned | conflicted
```

### Egg lifecycle

```text
incubating
  -> ready
  -> awaiting-special-adjudication
  -> hatching
  -> hatched
```

Terminal non-hatch states:

```text
cancelled | invalidated-by-gm
```

An accepted Egg is never silently deleted merely because a parent, breeder, Trainer, or source document later changes.

## Core contract families

```text
BreedingRulesetDefinition
BreedingSourceManifestEntry
BreedingSpeciesSpec
BreedingFamilySpec
BreedingCompatibilityResult
BreedingPermissionContribution
BreedingProjectDocument
BreedingParentSnapshot
BreedingTraitOffer
BreedingRollRecord
InheritanceCandidate
PokemonEggDocument
EggIncubationState
HatchSpecialAdjudication
PokemonBreedingOrigin
TrainerSpeciesAcquisition
BreedingOperationCommand / Result
BreedingPresentationProjection
```

## Compiled species boundary

The runtime consumes a strict app-owned registry rather than parsing `PokedexRecord` strings on demand.

```ts
interface BreedingSpeciesSpecV1 {
  schemaVersion: 1
  speciesId: string
  familyRootSpeciesId: string
  formPolicyId: string
  eggGroupIds: string[]
  genderPolicy:
    | { kind: 'ratio'; femalePercent: number }
    | { kind: 'genderless' }
  basicAbilityIds: string[]
  hatchCampaignMinutes: number
  eggMoveIds: string[]
  machineCompatibleMoveIds: string[]
  sourceHashes: string[]
}
```

The compiler must:

- merge app reference and authorised campaign override layers in deterministic order;
- resolve canonical aliases before emitting IDs;
- build and validate the complete evolution-family graph;
- distinguish evolutionary family from form or transformation relationships;
- convert hatch text to bounded campaign minutes at build or maintenance time;
- reject malformed ratios, unknown Egg Groups, missing moves, unknown basic Abilities, cycles, and ambiguous roots;
- emit source-hash-bound adjudications rather than silently repairing uncertain data;
- produce stable reports for missing, excluded, overridden, and campaign-specific entries.

## Durable project and Egg boundary

A breeding project records the process before an Egg exists:

```ts
interface BreedingProjectDocumentV1 {
  schemaVersion: 1
  projectId: string
  revision: number
  status: string
  rulesetId: string
  ownerTrainerSlug: string
  breederTrainerSlug: string
  parentRefs: readonly [PokemonSheetRef, PokemonSheetRef]
  consent: BreedingConsentState
  timeline: BreedingProjectTimeline
  check?: BreedingCheckRecord
  createdAtCampaignTime: number
  updatedAtCampaignTime: number
}
```

An Egg records an accepted, immutable offspring blueprint:

```ts
interface PokemonEggDocumentV1 {
  schemaVersion: 1
  eggId: string
  revision: number
  status: string
  ownerTrainerSlug: string
  source:
    | { kind: 'breeding'; projectId: string }
    | { kind: 'fossil'; sourceId: string }
    | { kind: 'gm'; reasonId: string }
  rulesetId: string
  definitionHashes: string[]
  parents: readonly BreedingParentSnapshot[]
  breeder: BreederSnapshot
  offspring: {
    speciesId: string
    familyRootSpeciesId: string
    nature: ResolvedBreedingValue
    abilityId: ResolvedBreedingValue
    gender: ResolvedBreedingValue
    inheritanceCandidates: InheritanceCandidate[]
  }
  incubation: EggIncubationState
  special?: HatchSpecialState
  childSheetSlug?: string
}
```

The child sheet receives a typed `PokemonBreedingOrigin` record. Existing `eggMoves` and `inheritedMoves` may be projected temporarily for compatibility, but lineage authority lives in the typed origin and permanent-move provenance.

## Default ruleset policy

BR-002 must freeze the exact default. The intended starting adjudication is:

1. Validate compatible parents under canonical Egg Group, Gender, Ditto, maturity, and campaign-option rules.
2. Resolve the selected parent family using the core d20 procedure unless a typed GM intervention bypasses it.
3. Resolve that family to its reviewed lowest-stage species or form-specific root.
4. Build the inheritance list from moves effectively known by either parent that are either on the child species’ Egg Move list or on its machine-compatible list.
5. Deduplicate by canonical move ID while retaining every parent and pathway source.
6. Resolve Nature, one Basic Ability, and Gender from bounded choices or replay-safe rolls according to effective Pokémon Education permissions.
7. Freeze the complete offspring blueprint when the Egg is accepted.
8. Allow the child to learn from the frozen inheritance list at canonical level checkpoints, applying errata prerequisites and leaving illegal earlier slots empty.
9. Make the special hatch roll once and persist it; a triggering result opens the configured bounded outcome workflow.

This policy remains an ADR, not an undocumented helper assumption.

## Operation and transaction policy

Normal operations include:

```text
previewBreeding
createBreedingProject
grantBreedingConsent
revokeBreedingConsent
advanceBreedingProjectTime
resolveBreedingCheck
produceEgg
cancelBreedingProject
transferEgg
advanceEggIncubation
markEggReady
beginHatch
resolveHatchSpecial
completeHatch
cancelEgg
recoverBreedingOperation
```

Every mutating command contains:

- a stable operation ID and schema version;
- the exact project or Egg identity and expected revision;
- authoritative Trainer, breeder, parent, owner, consent, and option references;
- server-issued choice option IDs;
- the effective ruleset and reference version expected by the client;
- bounded scopes or resource references used for conflict detection.

The executor must:

- parse and hash the command;
- detect an existing exact operation before rerunning mechanics;
- load every consulted document and provider into a complete read set;
- authorize actor, owner, breeder, parent control, and consent;
- resolve mechanics with injected, persisted randomness;
- commit all changed documents, the terminal operation result, audit evidence, and realtime events in one SQLite transaction;
- publish events only after commit;
- return the stored result on exact retry;
- reject an operation-ID collision with a different command;
- expose current authorised state on safe stale-revision conflicts.

Breeding must use the generic campaign-operation infrastructure produced by Feature automation or a neutral extraction of the existing operation-ledger pattern. It must not be forced through a map-scoped command executor.

## Hatching transaction

A successful hatch transaction must atomically:

1. lock or revision-check the Egg;
2. verify readiness and authorisation;
3. retrieve or record the single hatch-special roll;
4. resolve any required bounded GM adjudication;
5. allocate a collision-safe Pokémon slug;
6. insert the complete child sheet at revision 0;
7. add the child to the owner Trainer’s box, or to the active team only through an explicit legal choice with an open slot;
8. insert historical species acquisition with `INSERT OR IGNORE`;
9. grant first-species Trainer Experience only when that historical insert is new;
10. mark the Egg `hatched` and store the child slug;
11. persist lineage, inheritance, special outcome, ruleset, and source evidence;
12. store the terminal operation result and realtime events.

A duplicate or concurrent hatch must return the same child slug and must never create another Pokémon.

## Authorisation, consent, and privacy

Initial production acceptance may restrict project creation and hatching to the GM, but the data model and contracts must support safe player operation.

- A player must have a selected profile and access to the owner Trainer.
- A breeder Trainer must be controlled or explicitly delegated.
- Each parent must be linked to an authorised Trainer or covered by a GM override.
- Cross-owner projects require positive consent from every affected controlling profile.
- Consent records include project ID, parent slug and revision, consenting profile, scope, expiry or revocation policy, and audit timestamp.
- A parent owner may see their own parent and the safe project request without automatically seeing the other parent’s hidden sheet.
- Public views reveal only configured summaries such as “an Egg is incubating.”
- Owner views reveal Egg progress and owner-authorised traits.
- Participating-owner views reveal only the facts necessary for consent and their own parent.
- GM views reveal full mechanics, rolls, overrides, lineage, and recovery.
- Diagnostic views reveal hashes and traces only to authorised operators.

No Vue component may create privacy by merely hiding fields from a shared over-broad payload.

## Campaign time and incubation policy

- A versioned campaign clock or equivalent authoritative timeline owns in-world time.
- Breeding project phases and Egg incubation store campaign-time checkpoints and accumulated progress.
- Clock advancement is idempotent and uses stable advancement IDs.
- Manual `mark ready` is an audited GM operation, not an edit to elapsed-time fields.
- Downtime skips, time zones, calendar presentation, and real-world elapsed time do not affect mechanics unless explicitly configured.
- Hatch-duration modifiers declare whether they snapshot at Egg creation, contribute continuously, or apply at a reviewed checkpoint.
- Pausing, transfer, storage, facility changes, and source loss have explicit policies.
- No process timer or browser tab must remain open for progress to continue.

## Compatibility and migration policy

- Existing sheets remain readable and editable during rollout.
- No existing `eggMoves` or `inheritedMoves` entry is automatically treated as proof of a historical breeding event.
- A GM migration tool may create explicit legacy lineage only through reviewed user input and an audit record.
- Existing inherited-move UI becomes a projection/editor for typed inheritance state only after migration.
- Generated wild Pokémon may continue using generation-specific Egg Move helpers, but that path cannot create a durable Egg or breeding origin.
- Parent renames and folder moves use stable slug/reference policies; accepted snapshots retain display evidence and canonical IDs.
- Parent deletion reports affected projects and Eggs but does not erase accepted Egg snapshots.
- Export includes projects, Eggs, consents, operation results, acquisition history, and required reference-version metadata.
- Restore validates child/Egg links, duplicate operation identities, acquisition uniqueness, and ruleset availability before accepting authority.

## Plan update protocol

- Ticket states are `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.
- `CURRENT_TICKET` names the lowest-numbered active unfinished ticket.
- Only one ticket is `IN_PROGRESS` unless the decision log explicitly permits parallel source/data and UI fixture work.
- Mark a ticket `DONE` only after focused automated tests, required source evidence, privacy checks, and applicable visual/accessibility fixtures pass.
- BR-002 must record every canonical conflict and campaign option before BR-015 resolves offspring species.
- BR-008 must add plan, source, manifest, compatibility, operation, and delegation checkers before durable persistence work starts.
- New external interactions belong to the earliest unfinished owning ticket; add a ticket before implementing out-of-plan semantics.
- No ticket may introduce a second Egg or child-creation authority for convenience.
- Update progress from executable registries and migration reports after every phase.
- Set `PLAN_STATUS: DONE` only after BR-090, production-like acceptance, migration, documentation, backup/restore validation, and `scripts/quality-gate.sh` pass.

## Progress snapshot

- Plan tickets: **0 DONE / 90 total**
- Frozen breeding source inventory: **pending BR-001**
- Recorded ruleset/adjudications: **pending BR-002**
- Compiled species specs: **0**
- Compatible-species coverage: **unassessed**
- Durable breeding-project schema: **not created**
- Durable Egg schema: **not created**
- Campaign clock integration: **not started**
- Successful exactly-once hatch scenarios: **0**
- Feature/Edge interaction certification: **not started**
- Workshop UI and accessibility acceptance: **not started**
- Legacy breeding authority retired: **no**
- Blocking dependency: **Encounter UI/UX final acceptance**

## Tickets

### Phase 1 — Source governance, conflicts, policy, and measurable acceptance

- [ ] **BR-001 — Freeze the complete breeding, Egg, fossil, inheritance, and hatch source inventory and SHA-256 values** — `TODO`
- [ ] **BR-002 — Record the versioned breeding ruleset ADR and adjudicate every source conflict** — `TODO`
  - Cover parent-family selection, lowest-stage resolution, Ditto, genderless species, maturity, forms, hatch variation, special results, fossils, and Baby Template policy.
- [ ] **BR-003 — Freeze canonical Egg Group, Gender, parent-role, form, and no-breeding taxonomies** — `TODO`
- [ ] **BR-004 — Freeze the evolution-family and form-root graph policy** — `TODO`
- [ ] **BR-005 — Define hatch-duration parsing, units, bounds, variation, and campaign-time semantics** — `TODO`
- [ ] **BR-006 — Inventory every Edge, Feature, item, Ability, capability, facility, and campaign rule that can affect breeding or hatching** — `TODO`
- [ ] **BR-007 — Define the breeding threat model, consent policy, privacy matrix, and abuse limits** — `TODO`
- [ ] **BR-008 — Define source manifests, semantic registries, plan checks, coverage checks, and acceptance fixtures** — `TODO`
- [ ] **BR-009 — Record the runtime ADR, ownership map, contributor guide, operator guide, and baseline audit** — `TODO`

### Phase 2 — Compiled reference registry and pure breeding rules

- [ ] **BR-010 — Define canonical breeding species, family, Egg Group, move, Ability, and option IDs** — `TODO`
- [ ] **BR-011 — Define strict versioned `BreedingSpeciesSpec` and `BreedingFamilySpec` schemas** — `TODO`
- [ ] **BR-012 — Build the deterministic Pokédex-to-breeding-spec compiler and validation report** — `TODO`
- [ ] **BR-013 — Build and validate complete family-root, branch, regional-form, and special-form resolution** — `TODO`
- [ ] **BR-014 — Implement pure compatibility, parent-role, Ditto, genderless, maturity, and campaign-option evaluation** — `TODO`
- [ ] **BR-015 — Implement pure offspring family and lowest-stage species resolution** — `TODO`
- [ ] **BR-016 — Implement Nature, Basic Ability, Gender, rank-authorised choice, and random-option resolution** — `TODO`
- [ ] **BR-017 — Implement canonical inheritance candidate construction, deduplication, and provenance** — `TODO`
- [ ] **BR-018 — Implement hatch duration, fossil-level, Baby Template, and special-result rule helpers** — `TODO`
- [ ] **BR-019 — Add exhaustive examples, fuzzing, graph properties, boundary rolls, and deterministic replay tests** — `TODO`

### Phase 3 — Shared contracts, aggregates, commands, and projections

- [ ] **BR-020 — Define strict `BreedingProjectDocument v1` and lifecycle transitions** — `TODO`
- [ ] **BR-021 — Define strict `PokemonEggDocument v1` and lifecycle transitions** — `TODO`
- [ ] **BR-022 — Define `BreedingParentSnapshot`, `PokemonBreedingOrigin`, and inheritance-learning provenance** — `TODO`
- [ ] **BR-023 — Define versioned breeding commands, operation results, scopes, conflicts, and hashes** — `TODO`
- [ ] **BR-024 — Define replay-safe check, roll, option, consent, and GM-adjudication ledgers** — `TODO`
- [ ] **BR-025 — Define complete read sets, revision expectations, reference versions, and dependency evidence** — `TODO`
- [ ] **BR-026 — Define actor, owner, breeder, parent-control, cross-owner consent, and GM-override contracts** — `TODO`
- [ ] **BR-027 — Define public, owner, participating-owner, GM, and diagnostic presentation projections** — `TODO`
- [ ] **BR-028 — Define export, import, backup, restore, migration, and legacy-lineage schemas** — `TODO`
- [ ] **BR-029 — Add malformed, oversized, unknown-version, unsafe-text, privacy, and round-trip contract tests** — `TODO`

### Phase 4 — SQLite persistence, operation execution, time, and realtime

- [ ] **BR-030 — Add breeding-project, Egg, consent, acquisition-history, and supporting SQLite migrations** — `TODO`
- [ ] **BR-031 — Add project, Egg, consent, and acquisition repositories with strict parsing and optimistic revisions** — `TODO`
- [ ] **BR-032 — Add atomic fully-initialised Pokémon sheet creation with collision-safe slug allocation** — `TODO`
- [ ] **BR-033 — Add shared historical Trainer species-acquisition storage and reward service** — `TODO`
- [ ] **BR-034 — Add the generic campaign-operation idempotency and terminal-result ledger integration** — `TODO`
- [ ] **BR-035 — Add the authoritative campaign clock and idempotent time-advancement contract required by breeding** — `TODO`
- [ ] **BR-036 — Add breeding and Egg realtime events, access descriptors, snapshots, and replay adoption** — `TODO`
- [ ] **BR-037 — Add one transaction coordinator for project, Egg, sheet, Trainer, history, operation, and event writes** — `TODO`
- [ ] **BR-038 — Add export, backup, restore, integrity validation, and orphan-link diagnostics** — `TODO`
- [ ] **BR-039 — Add repository, migration, stale-revision, exact-retry, concurrency, and rollback tests** — `TODO`

### Phase 5 — Breeding project, consent, checks, and Egg production

- [ ] **BR-040 — Project Breeder and GM campaign-operation offers through the generic contract** — `TODO`
- [ ] **BR-041 — Implement authorised parent discovery, filtering, selection, and safe compatibility previews** — `TODO`
- [ ] **BR-042 — Implement maturity, ownership, consent, location/facility, and compatibility validation** — `TODO`
- [ ] **BR-043 — Implement durable initial four-hour project progress and interruption policy** — `TODO`
- [ ] **BR-044 — Implement the authoritative Breeder Pokémon Education check and exact retry** — `TODO`
- [ ] **BR-045 — Implement durable additional four-hour completion progress and project readiness** — `TODO`
- [ ] **BR-046 — Freeze parent, breeder, provider, reference, and campaign-option snapshots at reviewed checkpoints** — `TODO`
- [ ] **BR-047 — Resolve and persist offspring species, trait choices/rolls, inheritance, and source evidence** — `TODO`
- [ ] **BR-048 — Produce the Egg atomically and terminally settle the breeding project** — `TODO`
- [ ] **BR-049 — Add cancellation, consent revocation, expiry, abandonment, reconnect, and GM recovery** — `TODO`

### Phase 6 — Incubation, special outcomes, and exactly-once hatching

- [ ] **BR-050 — Implement authoritative Egg incubation totals, modifiers, pause policy, and progress queries** — `TODO`
- [ ] **BR-051 — Add audited GM `mark ready` and correction operations without direct field editing** — `TODO`
- [ ] **BR-052 — Integrate campaign-clock advancement, downtime skips, dedupe, and multi-Egg batching** — `TODO`
- [ ] **BR-053 — Implement Egg readiness, transfer, storage, facility, and source-loss lifecycle rules** — `TODO`
- [ ] **BR-054 — Project authorised hatch offers, blockers, choices, and owner destinations** — `TODO`
- [ ] **BR-055 — Implement the single persisted hatch-special roll and bounded GM outcome adjudication** — `TODO`
- [ ] **BR-056 — Build the complete child sheet from the frozen Egg blueprint and current schema contracts** — `TODO`
- [ ] **BR-057 — Commit child creation, Trainer linkage, Egg settlement, lineage, operation result, and events atomically** — `TODO`
- [ ] **BR-058 — Grant historical first-species acquisition and Trainer Experience exactly once** — `TODO`
- [ ] **BR-059 — Add duplicate hatch, concurrent hatch, failure injection, restart, replay-gap, and recovery tests** — `TODO`

### Phase 7 — Upstream interactions, alternate Egg sources, and lasting child mechanics

- [ ] **BR-060 — Integrate the Edge automation `Breeder` permission and contribution handoff** — `TODO`
- [ ] **BR-061 — Integrate Feature automation modifiers, facilities, tutoring, research, and campaign-operation providers** — `TODO`
- [ ] **BR-062 — Integrate item, Ability, capability, move, Nature, form, and campaign override contributions** — `TODO`
- [ ] **BR-063 — Define parent evolution, trade, rename, folder move, deletion, retraining, and source-update behaviour after project and Egg checkpoints** — `TODO`
- [ ] **BR-064 — Implement Egg ownership transfer, gifting, storage, consent, and privacy lifecycle** — `TODO`
- [ ] **BR-065 — Implement fossil-created Eggs through the shared Egg and hatch pipeline** — `TODO`
- [ ] **BR-066 — Implement GM-created, mysterious, gifted, and imported Eggs with typed provenance** — `TODO`
- [ ] **BR-067 — Implement the optional Baby Template and staged recovery without mutating species reference data** — `TODO`
- [ ] **BR-068 — Integrate frozen inheritance candidates with level-up learning, errata prerequisites, move slots, and permanent-move provenance** — `TODO`
- [ ] **BR-069 — Reuse acquisition history across capture, hatch, evolution, trade, release, and migration** — `TODO`

### Phase 8 — Breeding Workshop, presentation, consent UX, and accessibility

- [ ] **BR-070 — Add the Breeding Workshop route, navigation, ownership context, and empty/error states** — `TODO`
- [ ] **BR-071 — Implement the project wizard for breeder, parents, destination, consent, and timeline** — `TODO`
- [ ] **BR-072 — Implement compatibility explanations, unavailable reasons, source contributions, and GM diagnostics** — `TODO`
- [ ] **BR-073 — Implement rank-authorised Nature, Ability, Gender, campaign-option, and confirmation choices** — `TODO`
- [ ] **BR-074 — Implement project and Egg cards with progress, status, history, recovery, and transfer actions** — `TODO`
- [ ] **BR-075 — Implement the hatch decision flow, special adjudication, child reveal, and accepted presentation choreography** — `TODO`
- [ ] **BR-076 — Integrate child destination, team-limit explanations, box linkage, Trainer pages, and sheet navigation** — `TODO`
- [ ] **BR-077 — Implement cross-owner consent, revocation, notifications, private views, and GM override UX** — `TODO`
- [ ] **BR-078 — Complete responsive, keyboard, screen-reader, touch, zoom, reduced-motion, and table-distance acceptance** — `TODO`
- [ ] **BR-079 — Add Nuxt, Playwright, axe, multi-context, reconnect, visual-regression, and privacy browser suites** — `TODO`

### Phase 9 — Whole-system certification, migration, observability, and release

- [ ] **BR-080 — Enforce strict breeding-spec, project, Egg, operation, projection, and interaction manifest closure** — `TODO`
- [ ] **BR-081 — Run whole-species compatibility, family, trait, inheritance, hatch, and ruleset conformance suites** — `TODO`
- [ ] **BR-082 — Certify Edge, Feature, item, Ability, capability, move, form, fossil, Baby Template, and campaign-clock interactions** — `TODO`
- [ ] **BR-083 — Complete transaction failure injection, concurrency, idempotency, correction, abandonment, and disaster-recovery validation** — `TODO`
- [ ] **BR-084 — Complete authorization, consent, privacy, information-flow, malformed-input, and abuse testing** — `TODO`
- [ ] **BR-085 — Complete legacy migration, export/import, backup/restore, reference-version, and orphan-repair acceptance** — `TODO`
- [ ] **BR-086 — Enforce registry, preview, batch-clock, projection, and Workshop performance budgets** — `TODO`
- [ ] **BR-087 — Run production-like GM/player multi-client, long-timeskip, restart, transfer, and concurrent-hatch acceptance** — `TODO`
- [ ] **BR-088 — Complete contributor, operator, GM, player, API, data-model, campaign-clock, and QA documentation** — `TODO`
- [ ] **BR-089 — Retire manual breeding authority, placeholder child creation, and legacy inheritance mutation paths** — `TODO`
- [ ] **BR-090 — Record final acceptance and mark the breeding and Egg lifecycle production-authoritative** — `TODO`
  - Require source and manifest checkers, typecheck, unit/integration/Nuxt/browser/accessibility suites, build, production-like acceptance, backup/restore proof, and `scripts/quality-gate.sh`.

## Decision log

- **2026-07-28 — Make Eggs first-class campaign aggregates.** An Egg exists before a child sheet and therefore cannot be represented safely as a Pokémon sheet flag, inventory row, token, or roster entry.
- **2026-07-28 — Place breeding after the existing implementation-plan chain.** The work consumes completed Edge and Feature providers, generic presentation contracts, Workshop design primitives, browser infrastructure, and role-specific privacy projections.
- **2026-07-28 — Keep Edge permission separate from Egg authority.** The `Breeder` Edge supplies eligibility and contribution evidence; this plan owns every project, offspring, Egg, incubation, and hatch fact.
- **2026-07-28 — Freeze offspring facts on the Egg.** Accepted species, traits, inheritance, rolls, ruleset, and source evidence do not change when parents or reference data later change.
- **2026-07-28 — Make hatching exactly once and atomic.** Child creation, Trainer linkage, acquisition rewards, Egg settlement, operation result, and realtime events commit as one transaction.
- **2026-07-28 — Reuse the Egg lifecycle for fossils and authored Eggs.** Alternate sources change provenance and reviewed parameters, not the persistence or hatching architecture.
