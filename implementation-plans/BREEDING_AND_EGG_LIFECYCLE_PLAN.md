# Breeding and Egg Lifecycle Implementation Plan

`PLAN_STATUS: IN_PROGRESS`

`CURRENT_TICKET: BR-068`

`BLOCKED_BY: done/ENCOUNTER_UI_UX_PLAN.md — PLAN_STATUS: DONE`

`UPSTREAM_CONTRACTS: EDGE_AUTOMATION_PLAN.md, FEATURE_AUTOMATION_PLAN.md, done/AUTOMATION_PRESENTATION_CONTRACT_PLAN.md`

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
check-failed | cancelled | expired | abandoned | conflicted
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

- Plan tickets: **67 DONE / 90 total**
- Frozen breeding source inventory: **30 hash-bound runtime, contract, product, documentary, and parser records**
- Recorded ruleset/adjudications: **`ptu-1.05-breeding-v1` / 20 accepted conflict decisions / 15 typed campaign options**
- Compiled species specs: **862 runtime Species / 407 complete Families**
- Compatible-species coverage: **861 producible Species; unresolved rows fail closed**
- Durable breeding-project schema: **SQLite v26 strict repository active**
- Durable Egg schema: **SQLite v26 strict dedicated aggregate repository active**
- Atomic child-sheet insert: **strict complete-document revision-0 repository active**
- Historical Species acquisition: **shared immutable history plus hatch-integrated absent=one `dexExp` / present=zero reward validation active**
- Campaign-operation ledger: **durable two-phase reservation, exact replay, terminal settlement, and recovery active**
- Campaign clock integration: **authoritative campaign-minute singleton, CAS advancement, exact retry, and recovery active**
- Initial Project time: **durable cumulative 240-minute progress, interruption preservation, paused-time skip, and exact recovery active**
- Breeder check: **one persisted server d20 plus the current direct Pokémon Education or Dilettante-substituted General Education/Perception total against DC 12 with exact recovery active**
- Additional Project time: **durable cumulative 240-minute authorized segments, skipped consent gaps, exact readiness threshold, and replay-safe completion active**
- Egg-acceptance snapshots: **strict parent, Breeder, typed-provider, app-reference, and full campaign-option checkpoint package active**
- Offspring production: **persisted command-bound rolls, bounded rank choices, canonical traits, frozen inheritance provenance, and strict source closure active**
- Atomic Egg production: **revision-zero dedicated Egg, terminal Project transition, offer consumption, operation result, and privacy-scoped realtime commit together**
- Lifecycle recovery: **typed Project termination, consent revocation/expiry, pending-operation reconnect, exact resume, abandonment, and persisted publication retry active**
- Egg incubation: **campaign-clock-only cumulative progress, explicit audited pause/resume, immutable segment evidence, private totals queries, and exact recovery active**
- GM Egg readiness correction: **closed-reason command-bound override, progress-preserving ready transition, archive audit, and publication-silent replay active**
- Campaign-clock Egg batches: **server-discovered 100-Egg pages, paused downtime skips, deterministic child operations, exact dedupe, and prefix recovery active**
- Egg lifecycle policy: **status-derived readiness, mechanics-preserving transfer reduction, non-mutating storage/source-loss, and fail-closed facility handling active**
- Hatch-special workflow: **one durable command-bound d100 per Egg, closed 1/100 triggers, bounded non-Shiny GM adjudication, atomic settlement, and no-redraw recovery active**
- Complete child-sheet construction: **frozen-blueprint-only canonical newborn planning, current schema normalization, formula HP, no-placeholder revision-zero storage compatibility, and exact deterministic replay active**
- Atomic hatch settlement: **child, Species history/reward, Trainer link, Egg successor, immutable origin, terminal result, and six restricted refresh rows commit or roll back together**
- Successful exactly-once hatch scenarios: **2 focused box/team destination scenarios**
- Feature/Edge interaction certification: **direct and current Dilettante-granted `Breeder` handoffs active; nine Feature providers emit strict typed checkpoint evidence; facilities remain fail-closed**
- Fossil-created Eggs: **current GM source designation, Paleontologist/Skill/Reanimation Machine authority, bounded Level-10 blueprint traits, Restoration/Bond child effects, atomic source consumption, and shared incubation/hatch pipeline active**
- Workshop UI and accessibility acceptance: **not started**
- Legacy breeding authority retired: **no**
- Blocking dependency: **none; Encounter UI/UX is complete and archived**

## Tickets

### Phase 1 — Source governance, conflicts, policy, and measurable acceptance

- [x] **BR-001 — Freeze the complete breeding, Egg, fossil, inheritance, and hatch source inventory and SHA-256 values** — `DONE`
  - Evidence: `data/breeding-automation/source-manifest.json` freezes all 13 app-owned runtime references plus reviewed automation contracts, product authority, documentary provenance, and parser baselines by byte count, SHA-256, and Git blob. `tests/data/breedingSourceManifest.test.ts` passes with fail-closed authority and drift checks.
- [x] **BR-002 — Record the versioned breeding ruleset ADR and adjudicate every source conflict** — `DONE`
  - Evidence: `data/breeding-automation/ruleset.json` freezes definition SHA-256 `ab778e2ca678e8f823b78c2f2bec883ec6796b730d4996e24e5c07d40f6fea02`, 15 typed campaign options, and the default server-authoritative policy. `data/breeding-automation/source-adjudications.json`, `baseline-audit.json`, ADR 017, and `tests/data/breedingRulesetAdjudications.test.ts` close and verify 20 source/code conflicts, including the legacy map-metadata Egg path.
  - Covered parent-family selection, lowest-stage resolution, Ditto, genderless species, maturity, forms, hatch variation, special results, fossils, and Baby Template policy.
- [x] **BR-003 — Freeze canonical Egg Group, Gender, parent-role, form, and no-breeding taxonomies** — `DONE`
  - Evidence: `data/breeding-automation/taxonomies.json` freezes 14 canonical Egg Groups with exact mappings for all 19 current source cells, separate Gender and parent-role vocabularies, 10 form kinds, four root policies, four eligibility states, evidence kinds, and closed unavailable reasons under definition SHA-256 `086633909ce7499e5946e033d596145f469e09ebb2490e7d6985b6f19394ff8d`. `tests/data/breedingTaxonomies.test.ts` passes.
- [x] **BR-004 — Freeze the evolution-family and form-root graph policy** — `DONE`
  - Evidence: `data/breeding-automation/family-graph-policy.json` freezes exact-node edge acceptance, branch and form semantics, unique-root DAG invariants, deterministic ordering, compiled family requirements, failure reasons, and zero-error compiler gates under definition SHA-256 `ae677fe4a6d204e05a2c500e2dc5584b88ca2a10b80546c18a30b94e7541bc76`. `tests/data/breedingFamilyGraphPolicy.test.ts` passes malformed-source diagnostics and graph-property cases.
- [x] **BR-005 — Define hatch-duration parsing, units, bounds, variation, and campaign-time semantics** — `DONE`
  - Evidence: `data/breeding-automation/hatch-duration-policy.json` freezes exact parsing for all 10 recognized source values, campaign-minute arithmetic, bounded fixed/random/GM variation, revisioned idempotent clock semantics, incubation checkpoints, and Egg Warmer item/Capability contributions under definition SHA-256 `e9213cfd40afe1fb39e95adc6affec59a56d6e064d3678a46a50dbf274717b9a`. `tests/data/breedingHatchDurationPolicy.test.ts` passes all source histogram and boundary cases.
- [x] **BR-006 — Inventory every Edge, Feature, item, Ability, capability, facility, and campaign rule that can affect breeding or hatching** — `DONE`
  - Evidence: `data/breeding-automation/modifier-inventory.json` freezes 21 family-qualified canonical providers, all 15 campaign options, six reviewed keyword false positives, exact record/mechanic hashes, source gaps, zero canonical facilities, and effective-provider checkpoint policy under definition SHA-256 `24bb20a9d61003f540f6b410df3b0919ee49233012e45ec2dd14bfc9ed5c2dd9`. `tests/data/breedingModifierInventory.test.ts` proves closure over every broad canonical keyword match and provider dependency.
- [x] **BR-007 — Define the breeding threat model, consent policy, privacy matrix, and abuse limits** — `DONE`
  - Evidence: `data/breeding-automation/security-policy.json` and `docs/breeding/security-and-privacy.md` freeze revision-bound positive consent, five structural audience projections, 13 closed threats, privacy-safe realtime/local persistence, audit requirements, and exact payload/cardinality/rate limits under definition SHA-256 `83b97a053d054711de722c43debf482b1f0fa8ee03006d254f76905b376d4bf5`. `tests/data/breedingSecurityPolicy.test.ts` passes.
- [x] **BR-008 — Define source manifests, semantic registries, plan checks, coverage checks, and acceptance fixtures** — `DONE`
  - Evidence: `data/breeding-automation/semantic-registry.json`, the 90-row `scenario-requirements.json`, six synthetic fixture files with 21 scripts, and `scripts/check_breeding_automation.ts` freeze artifact, plan, gate, coverage, privacy, and fixture checks. Package and quality-gate commands are covered by `tests/scripts/breedingAutomationChecker.test.ts` and `tests/scripts/qualityGate.test.ts`; all focused Phase 1 checks pass.
- [x] **BR-009 — Record the runtime ADR, ownership map, contributor guide, operator guide, and baseline audit** — `DONE`
  - Evidence: ADR 018, `data/breeding-automation/ownership-map.json`, and the architecture, contributor, operator, and baseline guides freeze 22 single-writer fact boundaries, five atomic transaction groups, module layering, recovery practice, and the pre-runtime audit. `tests/data/breedingRuntimeOwnership.test.ts` and the breeding checker pass.

### Phase 2 — Compiled reference registry and pure breeding rules

- [x] **BR-010 — Define canonical breeding species, family, Egg Group, move, Ability, and option IDs** — `DONE`
  - Evidence: `data/breeding-automation/canonical-ids.json` freezes 1,149 species, 777 Moves, 483 Abilities, 14 Egg Groups, 15 campaign options, family/offer identity formats, exact record hashes, a collision-failing maintenance algorithm, and runtime exact-membership policy under definition SHA-256 `99e9ab4c4107086d64e2d70e7cdcaa7f9e10fd534f223f0ca053b2c1c4798d1e`. `shared/breeding/ids.ts`, the server-only catalog, and `tests/server/breedingCanonicalIds.test.ts` enforce the boundary.
- [x] **BR-011 — Define strict versioned `BreedingSpeciesSpec` and `BreedingFamilySpec` schemas** — `DONE`
  - Evidence: `data/breeding-automation/spec-schemas.json` and `shared/breeding/specs.ts` freeze exact versioned Species/Family shapes, bounds, canonical membership, provenance, self-hashes, deterministic order, DAG/form closure, and privacy-safe diagnostic projections under schema definition SHA-256 `a47dbd490e0485ce1adef9a823a9d76c27c12496e56c72dbfdd2f0f7bdb6163e`. `server/domain/breeding/specSchemaContext.ts` binds app-owned catalogs; `tests/server/breedingSpecSchemas.test.ts` passes strict and adversarial cases.
- [x] **BR-012 — Build the deterministic Pokédex-to-breeding-spec compiler and validation report** — `DONE`
  - Evidence: the source-bound compiler definition (extended by BR-013 bindings at `f0c2adcbefb6c395ff729d110b3ae5bcaf61ac36687061f3e4b9f3d898d4814a`), strict deterministic compiler, generated registry/report, write/check command, and `tests/server/breedingCompiler.test.ts` validate all 1,149 rows. Its pre-BR-013 baseline truthfully emitted zero specs until reviewed family/form resolutions existed; unresolved machine-only `Facade` references remain warning-only and never expose raw labels.
- [x] **BR-013 — Build and validate complete family-root, branch, regional-form, and special-form resolution** — `DONE`
  - Evidence: 127 reviewed target adjudications, 1,149 explicit form dispositions, source-bound Family resolution definition `b08a95059666e22a3617f3b2dbe6267dfbec8e019191c9547deb59dc5a777a29`, and the deterministic builder resolve 949 Species into 480 valid Families (32 branched, 54 regional-form members) while assigning closed reasons to all 200 exclusions. The strict runtime registry admits 862 Species/407 complete Families; `tests/server/breedingFamilyResolution.test.ts`, compiler tests/checks, checker, and typecheck pass.
- [x] **BR-014 — Implement pure compatibility, parent-role, Ditto, genderless, maturity, and campaign-option evaluation** — `DONE`
  - Evidence: compatibility policy `6a38a2ea1cf38b4d331a638ef94be2b9d1b6fb2781c668eedc84f0a6dcd7a34f`, strict self-hashed 15-option snapshots, and pure compatibility evaluation cover conventional roles, exact Ditto bypass/fallback, genderless and same-sex audited overrides, two maturity policies, canonical groups, malformed facts, and 14 stable reasons. `tests/server/breedingCompatibility.test.ts` and typecheck pass.
- [x] **BR-015 — Implement pure offspring family and lowest-stage species resolution** — `DONE`
  - Evidence: policy `d756e1bc3afa78562481f612f0be4f4836876a2de6dd17d24e53361393c4b119` and `offspringResolution.ts` implement injected core d20 boundaries, maternal and bounded GM contributor-family policies, unconditional non-Ditto fallback, compiled lowest-stage roots, family-bounded audited form overrides, excess-input rejection, and immutable provenance. `tests/server/breedingOffspringResolution.test.ts` and typecheck pass.
- [x] **BR-016 — Implement Nature, Basic Ability, Gender, rank-authorised choice, and random-option resolution** — `DONE`
  - Evidence: reviewed Nature catalog `d95d1ab8f6065c04790824a2258d99239907348081695f18e88a500a1ac9ff4e`, trait policy `85bbd7beabffe4f1eac3fe036ca99dc05fdbcef5a16ee3a2c053ab09954dcd72`, and pure resolvers implement ordered 2d6 Nature outcomes, sorted Basic Ability rolls, exact d100 Gender thresholds, fixed genderless results, Adept/Expert/Master choices, excess-input rejection, and immutable provenance. Eight focused tests and typecheck pass.
- [x] **BR-017 — Implement canonical inheritance candidate construction, deduplication, and provenance** — `DONE`
  - Evidence: policy `b30536b9757b436feac611ed64ed4a94eb1e5bd790b2e2fb7dd6d27c65f4b143` and `inheritanceCandidates.ts` define strict self-hashed two-parent effective-Move snapshots, canonical Move-only child Egg/machine pathways, one candidate per Move with all parent/pathway/evidence sources retained, closed limits, stable hashes, and fail-closed stale/malformed handling. Seven focused tests and typecheck pass.
- [x] **BR-018 — Implement hatch duration, fossil-level, Baby Template, and special-result rule helpers** — `DONE`
  - Evidence: helper policy `20d7daa639780db9e983e72a739d81a5a60b81f00e99a4f1135b7e777dc44ec7` and `eggRuleHelpers.ts` implement source-specific duration authority, fixed/random/GM variation, fossil Level, disabled-or-audited Baby Template effects, and one injected d100 special workflow that never implies Shiny. Missing configured special tables fail closed. Nine focused tests and typecheck pass.
- [x] **BR-019 — Add exhaustive examples, fuzzing, graph properties, boundary rolls, and deterministic replay tests** — `DONE`
  - Evidence: conformance report `e6cb7f6c284730e213730aeaa1c3cd20297f4c612c82113c267a9c6ebffd6d77` and `breedingPureRulesConformance.test.ts` exhaust all 407 Family DAGs, 862 compiled Species identities (861 producible), Basic Ability options, d20/ordered-2d6/d100/50–200 roll domains, reviewed fixture examples, 2,048 seeded malformed inputs, and 100 equal full-pipeline replays. The corrected inheritance fixture now supplies a true dual-parent/double-pathway candidate.

### Phase 3 — Shared contracts, aggregates, commands, and projections

- [x] **BR-020 — Define strict `BreedingProjectDocument v1` and lifecycle transitions** — `DONE`
  - Evidence: contract `89c077b9852f64d80b1c5fb3d920d04609c04f55acb0906f291bba8217c67d4e`, strict shared parser, and server lifecycle validator define exact opaque identities, two revision-bound parent refs, campaign timeline/check/Egg references, 12 closed statuses, monotonic successors, consent-revision rewind, immutable facts, and terminal settlement. The formerly implicit failed-check terminal is now explicit as `check-failed`. Eight contract tests and typecheck pass.
- [x] **BR-021 — Define strict `PokemonEggDocument v1` and lifecycle transitions** — `DONE`
  - Evidence: contract `20651a2a8010ff6135a7b330c3399d62f461303df8c2507d82b93402a5261f39`, strict shared parser, and server lifecycle validator define seven closed states; breeding, fossil, GM, and Feature sources; immutable offspring/lineage; campaign-minute incubation; one non-Shiny-implying special roll; transfer/pause/readiness; source-authority inheritance; and one child identity. Eight contract tests and typecheck pass; BR-022 extended the frozen parent snapshot without changing lifecycle authority.
- [x] **BR-022 — Define `BreedingParentSnapshot`, `PokemonBreedingOrigin`, and inheritance-learning provenance** — `DONE`
  - Evidence: lineage contract `2ee834c8c3d7b3e09dfd2e270acb40bd7ad68962f3cf38ac7065c8f80d926cfd`, shared exact-shape parsers, and server self-hash/link validators retain complete parent, Breeder, offspring, special, settled-Egg, and child evidence. Nine gap-free Level 20–100 records distinguish hatch construction from revisioned level-up batches, preserve illegal candidates, and bind learned Moves to permanent provenance without trusting legacy fields. Eight focused tests, typecheck, checker, and diff validation pass.
- [x] **BR-023 — Define versioned breeding commands, operation results, scopes, conflicts, and hashes** — `DONE`
  - Evidence: operation contract `310c713f9fc36c21f9671bef1c5194c81881683078785d3284959b4d093c7a9c`, 20-kind exact command union, nine closed campaign conflict scopes, server-only full-envelope SHA-256, self-hashed accepted/rejected results and receipts, exact retry/collision decisions, and deterministic scope conflict evidence. Eight focused tests cover every command kind, malformed/enriched input, underdeclared scopes, intent drift, result tampering, terminal divergence, and map independence; typecheck and checker pass.
- [x] **BR-024 — Define replay-safe check, roll, option, consent, and GM-adjudication ledgers** — `DONE`
  - Evidence: replay-ledger contract `46562b3e15f8647998cacd20a8fe383962001acb95e4b9f1f89a311de1943054`, five strict shared records, and server hash/link/lifecycle validators. Injected roll values cover eight closed purposes without reducer randomness; projects retain one command-bound DC 12 check; offers, revision-bound positive consent, and bounded GM adjudications settle once with immutable command evidence. Eight focused tests cover formulas, malformed/extraneous inputs, exact replay, collisions, expiry, stale consent, option consumption, adjudication links, and terminal non-reactivation; typecheck and checker pass.
- [x] **BR-025 — Define complete read sets, revision expectations, reference versions, and dependency evidence** — `DONE`
  - Evidence: read-set contract `89fed367e72bff696a1c95d0a4b3b0c3ff243dca61e60191649c4427e82b4f57`, strict shared contracts, and server capture/completeness/freshness validators. Every operation binds one immutable command-hashed read set to explicit presence/absence and revision facts, the campaign clock, all 13 app-owned reference versions, required contract versions, exact write expectations, and an attested effective dependency set. Seven focused tests cover command and option-snapshot binding, parent revisions, absence proofs, exact replay, stale resources/references/providers, malformed/enriched records, and hash tampering; typecheck and checker pass.
- [x] **BR-026 — Define actor, owner, breeder, parent-control, cross-owner consent, and GM-override contracts** — `DONE`
  - Evidence: authorization contract `08d98ea79e07355a87956a937637db442fd0b984be7abf51e2d731a926104c99`, strict actor/control/Breeder/consent/override/receipt records, and server-derived hash/link evaluators. Player authority requires a current stored Profile link; parent links are current and exact; cross-owner projects begin awaiting consent and later execution revalidates active consent in the exact command read set; Breeder authority is limited to effective Edge permission; GM bypasses require minimal typed command-bound overrides and reject extras. Seven focused tests cover same-owner setup, awaiting-consent creation, transactional consent and revocation, stale links/profiles, effective Edge evidence, full GM override composition, malformed claims, and exact replay; typecheck and checker pass.
- [x] **BR-027 — Define public, owner, participating-owner, GM, and diagnostic presentation projections** — `DONE`
  - Evidence: projection contract `185d5a8928b096fc75716a24de25a14fa60e346db338622985205e22b4e13826`, five structurally separate strict audience schemas, keyed public/diagnostic identities, and server access-checked projection builders. Public output omits raw identity, revision, and campaign time; owners receive only owned workflow facts and unexpired own offers; participating owners receive only their parent, consent, and contribution; GM ledgers are self-hash verified; diagnostics contain hashes and closed traces only. Seven focused tests cover Project and Egg privacy, hidden cross-owner identity, offer filtering, participant attribution, GM and operator access, audience mismatch, malformed/enriched data, and hash tampering; typecheck and checker pass.
- [x] **BR-028 — Define export, import, backup, restore, migration, and legacy-lineage schemas** — `DONE`
  - Evidence: archive/migration contract `50a6b4dbcf6659551d721d4a4c540624657f0ce7dcd635db5698ba334fc32edc`, strict shared schemas, and server digest/link validators define 64 MiB bounded campaign backups, GM audits, presentation-only owner exports, exact current-reference restore, GM-bound atomic import requests/receipts, source-hash-bound reviewed migrations, and fail-closed legacy-lineage review. Canonical chunks and records are self-hashed, operation/read-set/authorization chains and hatch/origin links are complete, stable identities allow exact replay only, map metadata is quarantine-only, and legacy Move fields cannot create parents or origin. Seven focused tests cover deterministic backup hashing, owner privacy, restore authorization/dependencies, receipts, legacy compatibility, and migration source evidence; typecheck and checker pass.
- [x] **BR-029 — Add malformed, oversized, unknown-version, unsafe-text, privacy, and round-trip contract tests** — `DONE`
  - Evidence: the archive contract suite now passes 13 focused tests, and the complete Phase 3 contract checkpoint passes 9 files / 74 tests. Adversarial cases reject non-plain, accessor-backed, sparse, enriched, duplicate-identity, hash-drifted, over-64-MiB, unsafe-path/control-text, and unknown-version inputs; owner exports remain projection-only with bounded non-leaking errors. Stable-JSON round trips preserve authoritative archive, request, receipt, review, migration, and restore validation hashes, while changed facts under archive/request/receipt/review/migration identities fail exact replay. Typecheck, checker, and diff validation pass.

### Phase 4 — SQLite persistence, operation execution, time, and realtime

- [x] **BR-030 — Add breeding-project, Egg, consent, acquisition-history, and supporting SQLite migrations** — `DONE`
  - Evidence: reviewed storage schema v22 `9f59dc2e0b1de4062398320ae155a8894560ddcef17627330c75d75e4f8a20b3` adds 16 dedicated project, Egg, consent, operation/evidence, lineage, acquisition, and campaign-clock tables with JSON, lifecycle, identity, deferred-link, and index constraints. Application and offline campaign migration SQL are byte-equivalent; v21 upgrades preserve campaign rows and deliberately create no authority from legacy map metadata. Five focused migration tests plus 29 existing storage/offline migration tests pass across fresh, upgrade, cyclic project/Egg transaction, uniqueness, restart, and constraint cases; typecheck and checker pass.
- [x] **BR-031 — Add project, Egg, consent, and acquisition repositories with strict parsing and optimistic revisions** — `DONE`
  - Evidence: repository contract `0f6510d7641800ee6222ec9f0f0842d29f582b388894d357ee88159ff59ca9c0` and four dedicated SQLite repositories enforce authoritative parsing, canonical stable JSON, duplicated-column consistency, app-owned Species/Move/Ability/Egg-Group/Nature membership, bounded queries, exact identity replay, immutable first-acquisition keys, and compare-and-swap revision successors. Repositories expose no delete or browser path and participate directly in caller-owned transactions. Eight focused tests cover exact replay/collision, legal/stale/missing revisions, strict consent expiry/settlement, canonical Egg/acquisition rejection, private corruption diagnostics, rollback, and file-database restart; migration/storage integration and typecheck pass.
- [x] **BR-032 — Add atomic fully-initialised Pokémon sheet creation with collision-safe slug allocation** — `DONE`
  - Evidence: initialized-child storage contract `b2348a70a50bf56a7440c0586724d1c11446ae1ce7b719bdfe0233d89f45c47d` and `server/storage/initializedPokemonSheetRepository.ts` accept only plain, exact-current-normalized, app-reference-bound complete child documents; storage alone assigns slug, folder, revision 0, and timestamps. One direct insert replaces placeholder-then-save, deterministic primary-key collision retries are Pokémon-kind scoped, and savepoints isolate failed attempts inside caller-owned transactions. Five focused tests cover complete one-write construction, same-name and cross-kind collisions, failure injection, nested rollback, restart persistence, malformed/enriched/accessor-backed data, unknown fields, forged authority, and canonical-reference rejection; typecheck, targeted lint, checker, and diff validation pass.
- [x] **BR-033 — Add shared historical Trainer species-acquisition storage and reward service** — `DONE`
  - Evidence: shared acquisition/reward contract `12484e4e476e09d537a70091e013ff0108f9c2c8dfba4dae7c9cc7d064b21306`, strict request schema, immutable source-kind/revision/time provenance, and `recordTrainerSpeciesAcquisition.ts` make `(Trainer, Species)` history—not roster or legacy `dexExp`—the only first-acquisition authority across capture, hatch, evolution, trade, migration, and reviewed GM sources. A new history row grants exactly one `dexExp` and one Trainer revision; later sources grant zero, exact operation replay mutates nothing, release retains history, and changed first facts collide. Savepoints keep history and reward atomic in caller-owned transactions. Seven focused tests cover first reward, later acquisition, exact replay, changed facts, injected rollback, stale/malformed/canonical/privacy-safe rejection, source/Egg pairing, legacy `dexExp` non-inference, and release; the 5-file persistence/archive checkpoint passes 38 tests, with typecheck, targeted lint, checker, and diff validation green.
- [x] **BR-034 — Add the generic campaign-operation idempotency and terminal-result ledger integration** — `DONE`
  - Evidence: generic campaign-operation ledger contract `76018f301208443b350e1a513a16d5d3fe6466e003de5d5419bb80b0551de350`, neutral adapter/coordinator, and strict Breeding SQLite adapter establish a durable phase-1 pending reservation before mechanics and a phase-2 aggregate-write plus terminal-result transaction. Same IDs require the full canonical command; terminal exact retries return stored results without mechanics or randomness, ordinary pending duplicates do not execute, and only an explicit recovery path resumes. Canonical command/scope/result rows, self-hashes, byte limits, compare-and-swap settlement, bounded pending/conflict queries, savepoint rollback, and caller-owned transaction enforcement fail closed. Eight focused tests cover exact replay, ID collision, pending duplicates, authorized resume, injected pre-settlement failure, atomic effects, accepted scope lookup, terminal-result conflict, corruption, write-boundary enforcement, and restart recovery; the operation/read-set/authorization integration checkpoint passes 5 files / 37 tests, with typecheck, checker, targeted lint, and diff validation green.
- [x] **BR-035 — Add the authoritative campaign clock and idempotent time-advancement contract required by breeding** — `DONE`
  - Evidence: campaign clock contract `b22780c11b2df7538068997cab457e8a2e5c68ffec9ecfff08223ef6f74a1c2f`, strict shared aggregate, CAS repository, and operation-ledger-backed use case make campaign minutes the sole lifecycle clock. Forward changes increment revision once and bind the operation; equal targets are audited no-ops; backward targets and stale revisions settle as typed rejections. Current ruleset and base scope are checked before reservation, ordinary pending duplicates cannot execute, exact retries cannot advance again, and failed settlement rolls clock mutation back while retaining recoverable pending evidence. Eight focused tests cover genesis, forward/exact replay, no-op, backward/stale, competing writers, injected rollback/resume, ruleset/scope closure, caller transaction enforcement, corruption, and restart; the 5-file clock/operation/migration checkpoint passes 36 tests, with typecheck, targeted lint, checker, and diff validation green.
- [x] **BR-036 — Add breeding and Egg realtime events, access descriptors, snapshots, and replay adoption** — `DONE`
  - Evidence: realtime contract `ce95ddce5ebe49348d5e62b5eb3d7a3994ab5bee6833ff7b2635dc2a5b06aa48`, strict refresh-only event/access schemas, and `server/realtime/breedingRealtime.ts` produce separate public, owner, participating-owner, GM, and diagnostic rows containing only keyed aggregate identity, revision, operation kind, and refresh scope. The durable event repository enforces the 4 KiB payload and descriptor/audience match on write and restart read; private scopes require direct selected-Profile Trainer control, diagnostic delivery requires explicit operator policy, and transient breeding events fail closed. Complete audience snapshots are bounded and identity-bound; monotonic adoption ignores stale revisions, invalidates newer aggregates, discards all projections on gap/ahead reconciliation, resets impossible ahead cursors, and accepts only a fresh complete replacement. Ten focused tests cover privacy, malformed inputs, access separation, snapshot conflict/replacement, rollback, post-commit ordered publication, exact dedupe, and file-database restart; the 8-file realtime checkpoint passes 118 tests, with typecheck and targeted lint green.
- [x] **BR-037 — Add one transaction coordinator for project, Egg, sheet, Trainer, history, operation, and event writes** — `DONE`
  - Evidence: transaction-coordinator contract `f1aa9e59ce5714977cb0cec69a5145748e5d94a288ed026a527f2f41d6297edb` and `server/useCases/executeBreedingTransaction.ts` enforce one top-level, synchronous phase-2 SQLite boundary across strict Project, Egg, complete child sheet, Trainer, immutable species-history/reward, campaign-clock, terminal-operation, and durable realtime repositories. Every injected repository must share the exact database object; planner access is a guarded database-free facade that expires after the callback; nested ownership, asynchronous planners, stale event dedupe material, duplicate sequences, and more than 1,000 event rows fail closed. The phase-1 reservation remains durable on rollback, explicit recovery reuses rolled-back event sequences without gaps, exact terminal retries run neither mechanics nor publication, and committed persisted rows publish in global sequence only after commit; publisher/reporter failure cannot undo authority. Six focused tests cover contract binding, complete Project commit/restart/exact retry, Project rollback/recovery, atomic Egg-child-Trainer-history-event rollback/recovery, mixed-connection/nested/async/event-replay rejection, and post-commit publication failure retention. The 7-file persistence/realtime checkpoint passes 49 tests, the checker suite passes 3 tests, and typecheck, targeted lint, checker, and diff validation are green.
- [x] **BR-038 — Add export, backup, restore, integrity validation, and orphan-link diagnostics** — `DONE`
  - Evidence: archive runtime contract `cd564d22ed4cd1b671999eb17374c96d902f796ef1b7a101e5f0814c7a1fc9f9` and byte-equivalent schema-v23 artifact `c8a91190b61d75a642b49764604357b0fa07f428386761912593657b01cc7cd8` add immutable strict archives, import requests, and one terminal restore receipt per request. `manageBreedingArchives.ts` takes one top-level synchronous SQLite snapshot for GM backups/audits and server-projected owner-portable exports, rejects pending or unrepresentable authority rather than omitting it, verifies the 64 MiB envelope bound before JSON parsing, requires exact current references/dependencies and authenticated GM evidence, and atomically commits imported archive, request, complete Breeding authority replacement, and receipt. Replacement requires an unchanged persisted checkpoint; new-campaign restore requires empty authority; exact request replay performs no replacement. Stable-hash GM diagnostics cover SQLite/FK integrity, strict row corruption, pending recovery, missing Trainer/parent/child/origin/acquisition links, and quarantined legacy map metadata without interpreting it. Seven focused tests cover immutable persistence/restart, identity collision/corruption, atomic restore/restart/replay, failure rollback, boundary rejection, integrity blockers, and dependency failure; the 4-file migration/archive checkpoint passes 29 tests, with typecheck and targeted lint green.
- [x] **BR-039 — Add repository, migration, stale-revision, exact-retry, concurrency, and rollback tests** — `DONE`
  - Evidence: Phase 4 persistence conformance contract `3605b35eae5ec7aa346d47a2ad3cad2da26ffe6668096dc22f0a8bf8eaa5c2d6` binds eight required test surfaces covering contiguous v22/v23 migrations, all strict aggregate repositories, complete child creation, exactly-once species rewards, operation/clock recovery, the transaction coordinator, archive restore, and cross-connection behavior. New file-database tests prove two SQLite connections serialize into one clock mutation, return the exact terminal operation on retry, terminally reject the stale competing writer, accept only byte-semantic archive replay, reject changed facts under a shared archive identity, and keep a failed export invisible across connections. The bounded Phase 4 checkpoint passes 11 files / 73 tests, including migration parity, stale and missing revisions, identity collision, injected rollback, explicit pending recovery, post-commit publication isolation, atomic restore, restart persistence, and orphan diagnostics; typecheck and targeted lint pass.

### Phase 5 — Breeding project, consent, checks, and Egg production

- [x] **BR-040 — Project Breeder and GM campaign-operation offers through the generic contract** — `DONE`
  - Evidence: campaign-offer contract `6bc6bf7f982dd9ec4bc189e5d070fc52a1c2a3f242790f7874f6c785e463d80c`, strict source-neutral offer/declaration schemas, and a self-hashed Breeding authority envelope project deterministic one-campaign-minute preview/create affordances without projecting command, Profile, evidence, parent, ledger, map, or encounter facts. Owner offers require exact current Profile control of both command Trainers and matching effective `Breeder` Edge evidence; absent evidence yields only the bounded unavailable reason, while stale or malformed evidence rejects. Authenticated GM offers use `breeding.v1` system authority but manufacture no Edge, consent, control, or override. Consumption rebuilds current server authority before matching offer ID, definition hash, and operation ID, and remains distinct from downstream operation authorization and settlement. Seven focused tests cover deterministic/exact replay, owner and GM projection, unavailable behavior, privacy, current-time/reference/control drift, declaration tampering, malformed inputs, and map independence; typecheck and targeted lint pass.
- [x] **BR-041 — Implement authorised parent discovery, filtering, selection, and safe compatibility previews** — `DONE`
  - Evidence: parent-discovery contract `08c510ca626cb91097c9adea15fa1d11c2b36de188b8e357da1676504bf0b33a`, strict request/projection schemas, and `discoverBreedingParentsV1` authorize before reading or filtering candidates. Players can discover only current team/box rows of the exact Profile-linked selected Trainer; public sheet flags, legacy access, browser visibility, and map state grant nothing. GM discovery remains campaign-principal-bound and infers no Profile control, consent, or override. Duplicate roster ownership fails closed; missing/malformed/spec-unavailable candidates manufacture no mechanics. Canonical roster, availability, and Species filters run after authorization, while zero-to-two selections bind only visible exact revisions. Pair previews reuse the pure compiled compatibility resolver, expose bounded reasons, and label plausible pairs `requires-validation` with all final ownership, maturity, consent, location/facility, compatibility, and revision checks still outstanding. Seven focused tests cover owner/GM privacy, filtering, compatible and incompatible previews, IDOR/stale/duplicate selection, Profile drift, ambiguous/corrupt storage, malformed boundaries, and map independence; typecheck and targeted lint pass.
- [x] **BR-042 — Implement maturity, ownership, consent, location/facility, and compatibility validation** — `DONE`
  - Evidence: project-setup validation contract `a542075506296f43057f7759bd54460601ef29839e5311eda6a48ef302d843b3`, strict shared authority/projection schemas, and a self-hashed server validator compose the BR-026 authorization receipt with command-ordered current parent facts, compiled Species specs, campaign options, maturity, the closed off-map Workshop policy, and canonical compatibility. Evaluation is staged so unauthorized, awaiting-consent, and unsupported-facility outcomes reject private mechanics evidence before loading it. Same-owner control is revalidated exactly; cross-owner preview fails safely, creation returns only `awaiting-consent`, and later positive consent remains bound to the BR-026 current-project operation path. Default maturity requires two exact positive resolved GM confirmations plus a persisted authenticated-GM settlement-chain recheck; minimum-Level campaigns reject low levels and extraneous confirmations. Same-sex intervention consumes only one matching bounded parent-role offer strictly before campaign-minute expiry, with free text forbidden. The reviewed zero-facility inventory fails closed on any facility dependency; maps and encounters grant no location authority. Nine focused tests cover ready, maturity, consent, facility, incompatibility, bounded-role, expiry, privacy, stale-reference, malformed, enriched, sparse, extraneous, and hash-tampering cases; typecheck and targeted lint pass.
- [x] **BR-043 — Implement durable initial four-hour project progress and interruption policy** — `DONE`
  - Evidence: initial-progress contract `6394aee50c505a9c3f355493f06fac633528b8e1ed38edd66b8584080f56ca00`, strict segment/projection schemas, and the Project initial-time use case make 240 cumulative campaign minutes the sole completion authority. Ready setup starts at the exact current clock checkpoint; awaiting-consent setup does not start. Interruption credits only the valid prefix, preserves progress, skips paused time, records monotonic parent refreshes, and resumes from a fresh checkpoint; overshoot records the exact threshold minute. Immutable read-set/authorization pairs, Project CAS, terminal result, and bounded realtime refresh rows commit in one phase-2 transaction; failures retain only a recoverable pending reservation, while terminal retries and restart replay cannot reaccrue or republish. Nine focused tests cover creation, cross-owner privacy, cumulative boundaries, interruption/resume, parent drift, malformed authority, rollback/recovery, durable restart, and exact evidence replay; typecheck and targeted lint pass.
- [x] **BR-044 — Implement the authoritative Breeder Pokémon Education check and exact retry** — `DONE`
  - Evidence: Project-check contract `975d2ef2dde5d10a0ffb262eccb1be78a83057adcf7a7cd3438e7fc64af96ea8`, strict ledger storage, and `resolveBreedingProjectCheck.ts` implement one current effective-Breeder Pokémon Education check against DC 12. After durable operation reservation, one server d20 is committed with exact read-set/authorization evidence before the reducer; unavailable or stale commands draw nothing, phase-2 failure retains the one roll for explicit recovery, and terminal retry never redraws. Current parent revisions and positive cross-owner consent are rechecked; GM override cannot stand in for consent. Success starts zero-minute additional progress at the current campaign checkpoint, while failure terminally records `check-failed`. Nine focused tests cover DC boundaries, success/failure, consent, privacy, malformed/extraneous authority, strict storage, rollback/pending recovery, exact retry, and file-database restart; typecheck and targeted lint pass.
- [x] **BR-045 — Implement durable additional four-hour completion progress and project readiness** — `DONE`
  - Evidence: Additional-progress contract `408d9ebc09a3649f909207f8038adb30b336138eaa6c7d17bffb7f63cc4ff539`, strict segment/projection contracts, pure planning, and `advanceBreedingProjectAdditionalTime.ts` require the exact successful persisted check plus current Project, campaign clock, parent, reference, consent, read-set, receipt, and self-hashed segment authority. Progress accumulates monotonically across durable campaign-clock commands, caps at 240, and records the exact threshold minute under overshoot. The server derives each credited interval; a fresh cross-owner consent grant skips the unauthorised gap, expiry equality is unavailable, and parent drift after check cannot accrue. Evidence, Project CAS, terminal result, and bounded refresh rows share one phase-2 transaction; failure retains only the pending reservation, explicit recovery is exact, and terminal retry cannot reaccrue or republish. Nine focused tests cover cumulative completion, skipped gaps, stale/tampered authority, strict privacy, rollback/recovery, exact retry, and restart; typecheck and targeted lint pass.
- [x] **BR-046 — Freeze parent, breeder, provider, reference, and campaign-option snapshots at reviewed checkpoints** — `DONE`
  - Evidence: Production-snapshot contract `1289a07c793cde3bcd4077a7ba97610bf4985559419db82c03c070e8569d557f`, strict shared contracts, and `productionSnapshots.ts` construct a deeply frozen Egg-acceptance package only for the exact current `ready-to-produce` Project and `produce-egg` command. Ordered parents bind source revisions/hashes, compiled specs, roles, maturity, effective-Move provenance, and control/consent; the current Breeder binds Trainer/rank/effective Edge authority. Typed provider values require reviewed modifier-inventory IDs, exact dependencies/receipt hashes, and one complete-snapshot system attestation. Every app-owned reference hash and all 15 campaign-option values are frozen, with an exact sorted accepted-definition closure. Cross-owner expiry and GM-override substitution fail closed. The package has no standalone or client authority and becomes durable only with the BR-048 Egg transaction. Nine focused tests cover nested hashes, provider completeness, stale facts, consent, reference/options drift, deep immutability, and bounded projection privacy; typecheck and targeted lint pass.
- [x] **BR-047 — Resolve and persist offspring species, trait choices/rolls, inheritance, and source evidence** — `DONE`
  - Evidence: Offspring-production contract `90f0c314e25b521d98dfe83a0733bf80e39e345a6446af99a265066a71d7e250`, strict shared resolution/projection schemas, and `offspringProduction.ts` bind the exact BR-046 snapshot to gap-free persisted server rolls, current rank-authorized offers, canonical Family/Species/trait authorities, and frozen inheritance provenance. Family d20, ordered Nature 2d6, exact Gender d100, and Ability uniform-index semantics reject missing, extraneous, reordered, stale, or biased rolls; Ability die sides equal the exact Basic Ability inventory. Offers expire at equality and plan one monotonic command-bound consumed successor for the BR-048 transaction. The immutable blueprint retains parent/pathway/known-Move evidence and a complete policy/registry/source hash closure; provider contributions remain fail-closed pending reviewed reducers. Dedicated roll and option-offer repositories require caller transactions and exact replay. Twelve focused tests cover random and bounded-choice resolution, inheritance, privacy, malformed/tampered authority, durable ledgers, CAS consumption, and deterministic replay; typecheck and targeted lint pass.
- [x] **BR-048 — Produce the Egg atomically and terminally settle the breeding project** — `DONE`
  - Evidence: Egg-production contract `14945bf105a98509d1e1212811b476914ec42c2f9c60a9157146066dce63dd0e`, strict shared projection and domain planners, and `produceBreedingProjectEgg.ts` reserve the command and persist immutable operation evidence plus each complete server roll before reduction. Phase 2 transactionally rebuilds current snapshot, check, clock, parent/Breeder revisions, consent, offers, and BR-047 resolution; consumes selected offers; inserts one revision-zero dedicated incubating Egg; advances the Project to `egg-produced`; settles the operation; and stages privacy-scoped refresh rows. Fixed-average incubation starts at zero at the exact clock checkpoint; special and child state remain empty. Any phase-2 fault rolls back Egg, Project, offers, result, and events while retaining evidence/rolls for exact no-redraw recovery. Egg realtime structurally excludes participating owners. Eleven focused tests cover random and bounded-choice production, cross-owner consent/privacy, partial-random and phase-2 recovery, exact retry, stale parent/clock no-draw rejection, malformed authority, atomic rollback, restart, and post-commit events; typecheck and targeted lint pass.
- [x] **BR-049 — Add cancellation, consent revocation, expiry, abandonment, reconnect, and GM recovery** — `DONE`
  - Evidence: lifecycle/recovery contract `c51a74fed4eeb83a3ad6cca8a41300cd7f90d4f5397a84d28873f5cf0da80b5c`, strict lifecycle/recovery projections, current-authority receipt recomputation, and two server use cases. Owner cancellation, campaign-time consent expiry, GM abandonment/conflict, and consenting-owner revocation create monotonic Project/consent successors atomically with operation evidence, terminal results, and refresh rows; equality is expired, terminal Projects remain immutable, and post-acceptance revocation never rewrites an Egg. GM recovery strictly inspects, exactly resumes, atomically abandons, or retries publication from a durable target; callback failures remain pending and crash-after-target settlement converges without redispatch. The GM-only restart-persistent reconnect query is bounded and omits payloads, scopes, receipts, hashes, and mechanics. Eight focused tests cover cancellation/retry/realtime, revocation rollback/recovery, expiry equality, GM abandonment, malformed/stale/unauthorized input, inspect/abandon, resume crash convergence, publication recovery, privacy, and file-database reconnect; 50 focused regressions, typecheck, targeted lint, and checker pass.

### Phase 6 — Incubation, special outcomes, and exactly-once hatching

- [x] **BR-050 — Implement authoritative Egg incubation totals, modifiers, pause policy, and progress queries** — `DONE`
  - Evidence: Incubation contract `d9aed047dfc2e06166e33e284e91a27c483e456f3dfa56c2b0a123c5382cf587`, schema-v24 artifact `021294114d4f027c68f18b37625181e1c46f60c069186bf3e377c6b74fc876ff`, strict shared projections/segment schemas, and `managePokemonEggIncubation.ts` bind each advance or explicit pause operation to the current Egg, campaign clock, owner/GM authority, complete read set, and one base-rate dependency attestation. Campaign minutes accrue cumulatively to the immutable target, overflow remains segment-only, threshold time is exact, paused intervals are skipped, and transfer/storage/parent or Breeder loss cannot implicitly pause. Phase 1 atomically binds the pending reservation to its exact read set and receipt; every accepted Egg successor, immutable incubation segment, operation result, and four privacy-scoped refresh rows then commit atomically. Rollback retains recoverable reservation/evidence and exact retries remain revision/publication silent. Owner/GM queries expose only totals, pause/readiness, clock checkpoints, and actions. At BR-050 completion non-empty modifier evidence failed closed; BR-062 later activated only exact Egg Warmer item/capability authority while preserving unknown-facility rejection. Eight focused tests, 313 Breeding regressions, storage/offline migration parity, archive/coordinator regressions, typecheck, and targeted lint pass.
- [x] **BR-051 — Add audited GM `mark ready` and correction operations without direct field editing** — `DONE`
  - Evidence: Readiness-correction contract `015e3b460250d024aec53f2d5534134135b09749f2867341ef66d8642b7fc74e`, strict shared GM projection, pure reducer, exact authorization, `markPokemonEggReady.ts`, archive cross-link validation, and five ticket-focused cases in the 13-test incubation suite. `mark-egg-ready` requires one current authenticated GM, a closed typed reason, a self-targeted command-bound recovery override, the exact current Egg and campaign clock, and one complete correction-policy dependency attestation. The successor preserves target, accumulated progress, and incubation clock checkpoints while atomically recording `gm-mark-ready` at the current campaign minute; paused Eggs require a separate audited resume and repeated/reverse corrections fail closed. Phase-2 rollback leaves only recoverable phase-one evidence, restart/exact retry cannot revise or republish, owner projections never expose the correction reason or authority evidence, and participating-owner realtime access remains structurally forbidden. Focused incubation, archive, transaction, production-snapshot, offspring, and Egg-production regressions, 357 broad Breeding checks, typecheck, targeted lint, and the full current-source quality gate pass.
- [x] **BR-052 — Integrate campaign-clock advancement, downtime skips, dedupe, and multi-Egg batching** — `DONE`
  - Evidence: Campaign-clock incubation batch contract `b693b6a90ca99a4b81301f71db8685ad9890e93eb8d54c73bdcf2f88c5b1d942`, strict shared GM projection, deterministic parent/child identity policy, exact GM authorization, due-Egg repository query, `advanceBreedingCampaignClockBatch.ts`, archive parent/child cross-links, and eight focused tests. The server discovers the canonical first 100 due incubating Eggs, rejects stale/omitted/reordered/client-selected scopes, and derives one command-bound BR-050 child operation per Egg. Long downtime credits ordinary intervals, skips paused intervals, retains exact threshold/overflow evidence, and never consults wall, process, browser, map, or encounter time. Forward and equal-target parent commands support bounded continuation; parent/child/Egg checkpoints dedupe exact retries. Parent rollback retains its evidence, while partial child failure preserves the complete prefix and one pending child for exact recovery without duplicate revisions or publication. Batch output is GM-only and excludes blueprints, traits, parent/Breeder/Profile/consent/provider facts, commands, receipts, and hashes. Focused batch, clock, incubation, archive, repository, and production checks, 365 broad Breeding regressions, typecheck, targeted lint, and the full current-source quality gate pass.
- [x] **BR-053 — Implement Egg readiness, transfer, storage, facility, and source-loss lifecycle rules** — `DONE`
  - Evidence: Egg lifecycle-policy contract `dc0d4648f2ffc492f802652a9ca27d865f6e6e42444acae2893153a5ff8a1440`, strict shared owner/GM assessment and observation schemas, policy hash `477985e3502e78f04afd428c682cc81ad1147c8caf8ed41af0262fcf5b0ff2df`, current-authority lifecycle query, pure transfer reducer, strengthened Egg parser/successor invariants, and ten focused policy tests. Readiness is status-derived: only `ready` is eligible for a first hatch, hatch-in-progress and settled states cannot restart, and non-incubating Eggs cannot remain paused. Pre-hatch transfer changes only owner/revision/update minute/operation ID and preserves progress, pause, readiness, clock checkpoint, blueprint, special, and child state; generic successors cannot smuggle mechanics. Storage and accepted parent/Breeder/Project/origin loss remain non-mutating diagnostics that do not pause, unready, invalidate, or block hatch. Facility removal preserves base rate, while every claimed facility remains unavailable because the canonical registry is empty. Durable transfer consent/privacy stays reserved for BR-064, provider effects for BR-061, and source integrations for BR-063/065/066. Focused lifecycle, Egg-contract, production-snapshot, offspring, and production tests, 375 broad Breeding regressions, typecheck, targeted lint, and the full current-source quality gate pass.
- [x] **BR-054 — Project authorised hatch offers, blockers, choices, and owner destinations** — `DONE`
  - Evidence: Hatch-offer contract `13bcad7eda6fd6e3356bac3a043f1bfdc8a3e06b1f487a9d1aa0cb4b50097111`, strict shared authority/projection schemas, current-storage use case, deterministic box/team choices, closed lifecycle/capacity blockers, and ten focused tests. Every offer binds one exact `begin-hatch` command, current authoritative Egg/ruleset/reference snapshot, current campaign minute, owner Trainer document/revision, actor/control evidence, lifecycle policy, and security policy. Owner offers require exact current Profile control; GM offers require a current synchronous campaign-principal verifier. Box remains available for a lifecycle-ready Egg, while team requires one of six slots; lifecycle blockers apply first to both destinations, and accepted source loss never becomes a blocker. Consumption regenerates current authority and matches the offer ID/hash/operation ID exactly; expiry is effective at equality, unavailable declarations fail, and unchanged retries are byte-equivalent. The owner/GM projection exposes only coarse Egg state, bounded offer/choice data, owner destination, safe blockers, and remaining slots—never roster identities, blueprint, lineage, Profiles, consent, commands, internal hashes, read sets, receipts, rolls, or providers. BR-054 performs no mutation, reservation, roll, or publication. Focused hatch-offer and related lifecycle/offer/production regressions, broad Breeding regressions, typecheck, targeted lint, the automation checker, and the full current-source quality gate pass.
- [x] **BR-055 — Implement the single persisted hatch-special roll and bounded GM outcome adjudication** — `DONE`
  - Evidence: Hatch-special contract `2fb00d9ccedca2294fb7d8697cd4e483b54774e5873b2e5e4df0edb9f73b6f44`, runtime policy `dea894103ccc00bc4f271fbdc23c05eb937bc6f28afc95d50fc20cf6daf8305d`, strict owner/GM projections, exact begin/resolve authorization, a dedicated GM-adjudication repository, Egg-singleton roll enforcement, and two atomic use-case paths. `begin-hatch` persists one command/revision/campaign-bound d100 before reduction; 2–99 enters `hatching`, while 1/100 creates one deterministic bounded offer/adjudication and enters `awaiting-special-adjudication`. Current GM resolution consumes one of three nonmechanical options and enters `hatching`; no total or option implies Shiny, provider force remains fail-closed without exact persisted rank-bounded use consumption, and the unreviewed configured table fails closed. Phase-2 rollback retains only pending authority and the one roll, recovery never redraws, terminal retries never revise or republish, archive links are verified, and owner output omits roll/offer/adjudication facts. Seven focused cases plus hatch-offer, helper, repository, transaction, and archive regressions pass; typecheck and targeted lint pass.
- [x] **BR-056 — Build the complete child sheet from the frozen Egg blueprint and current schema contracts** — `DONE`
  - Evidence: Child-sheet construction contract `c98004bb73ff772ac1d16681525e7d0dd38b6f041073ce7f3ac22fdd1fb1a14b`, runtime policy `9fb963024d3d6a139c425968a2621110ae97458dd7f6ce71415e7ed030bd249d`, and `childSheetConstruction.ts` create one deeply frozen, self-hashed server-private plan only from an exact current `hatching` Egg and `complete-hatch` command. Frozen Species, Nature, Basic Ability, Gender, starting Level, and inheritance IDs resolve only through app-owned canonical JSON and exact compiled Species authority. The normalized newborn receives exact Experience, source-ordered level-up Moves, compatibility-only Egg Moves, full formula HP, false Shiny, and no applied Moves or Poké Edges; storage-owned identity/revision/time fields remain absent for the BR-032 one-write allocator. Exact replay rejects changed plans, while Baby Template and Level-20+ hatch checkpoints fail closed until BR-067/BR-068. Seven focused cases cover contract binding, revision-zero repository acceptance, deterministic Level/trait construction, special privacy, stale/enriched/wrong authority, reserved integrations, and replay tampering; focused regressions, typecheck, targeted lint, checker, and the current-source quality gate pass.
- [x] **BR-057 — Commit child creation, Trainer linkage, Egg settlement, lineage, operation result, and events atomically** — `DONE`
  - Evidence: Hatch-completion contract `fe87fdc6034d8262f083d220fb0bdceda7c269b642a62567ea2f22aa0b1cf77c`, strict coarse projection, current-authority authorization, `completePokemonEggHatch.ts`, and the dedicated lineage repository bind the exact begin destination, hatching Egg, owner Trainer, campaign clock, Species-acquisition state, reference snapshot, and self-hashed BR-056 plan. One BR-037 phase-2 transaction inserts the complete revision-zero child, applies conditional first-Species history/reward, links exactly one team/box roster, settles the Egg, inserts one unique immutable origin, accepts the operation, and stages six sheet-access/Egg refresh rows. Faults roll every phase-2 write back while retaining recoverable evidence; exact owner/GM retries revalidate current authority and cannot recreate or republish. Six focused hatch tests plus the coordinator lineage rollback extension cover box/team settlement, privacy, recovery, strict malformed/stale authority, and post-commit publisher failure; typecheck and checker pass.
- [x] **BR-058 — Grant historical first-species acquisition and Trainer Experience exactly once** — `DONE`
  - Evidence: Hatch Species-acquisition contract `b1ef8d723e80618863b8acdff6cb0e37ed909e568a99cd9fb7e7fecc82b6243e`, runtime policy `a7c0882dd835179b236cc556e795fb17992d75309864a803be73dab0a4007e78`, existing immutable history/reward service, and `hatchSpeciesAcquisition.ts` certify the only two legal fresh hatch outcomes. An absent `(Trainer, Species)` identity inserts exact hatch/Egg/operation/time facts and grants one `dexExp`; a present identity preserves its original source facts and grants zero. Both paths remain inside BR-057 before roster linkage, with exact Trainer revision and Experience arithmetic checked against the phase-1 presence read. Terminal retry bypasses the service, roster removal cannot erase history, and neither `dexExp` nor roster content implies acquisition. Fifteen focused service/hatch tests cover first reward, prior-source no-reward, exact replay, changed facts, rollback, malformed authority, history after roster removal, and contradictory participant rollback; typecheck and checker pass.
- [x] **BR-059 — Add duplicate hatch, concurrent hatch, failure injection, restart, replay-gap, and recovery tests** — `DONE`
  - Evidence: Hatch-resilience contract `5ce3c17dacdf7320ac3a2d3aa5e656adbacfb489c5019c5a62011ac75b47b810` and twelve focused hatch cases certify exact duplicate replay, changed-operation rejection, two-connection stale races, pending-loser stale settlement, post-child and pre-settlement rollback, contradictory reward rollback, file-database restart/resume, replay-gap behavior, and publisher-failure retention. `BEGIN IMMEDIATE`, complete authority comparison, CAS writes, immutable child/origin/history identities, and one terminal operation allow exactly one complete winner. A pre-reserved loser is recoverable and settles stale without writes/events; process restart reuses persisted evidence; a pruned cursor returns an empty gap and exact retry never replays mechanics or repopulates events. Every injected phase-2 fault leaves only the pending reservation/evidence and recovery converges to one child, one origin, one Trainer/Species history, and six fresh rows. Focused hatch, coordinator, reward, realtime, and repository regressions, typecheck, targeted lint, and checker pass.

### Phase 7 — Upstream interactions, alternate Egg sources, and lasting child mechanics

- [x] **BR-060 — Integrate the Edge automation `Breeder` permission and contribution handoff** — `DONE`
  - Evidence: Breeder Edge handoff contract `6d00f0adbf87c5751d1f5df6973325b29c78b9636f1fcf92d55b038299dcf55e`, strict server-private shared bundle, current-storage resolver, and Edge campaign-planner integration bind exactly one effective unsuppressed Trainer `Breeder` instance to its canonical record/runtime hashes, current Trainer revision/document, current campaign minute, current Profile or GM access, Pokémon Education rank/check contribution, and one matching read-set dependency. Edge automation contributes only `breeding-project-request` and `breeder-dc12-timeline`; `breeding.v1` retains all Project, time, d20/DC, Egg, and hatch mechanics. Missing, duplicate, unresolved, suppressed, below-Novice, stale, enriched, source-drifted, asynchronous, or faulting providers fail without mutation. Campaign-shared and Feature-granted Breeder authority remain gated to BR-061. Ten focused integration/failure cases plus 57 Edge, offer, setup, check, snapshot, and authorization regressions, typecheck, and targeted lint pass.
- [x] **BR-061 — Integrate Feature automation modifiers, facilities, tutoring, research, and campaign-operation providers** — `DONE`
  - Evidence: Feature-provider handoff contract `e7bf7050964a469b3a155a59d6c4e40be67c81c00c3550a2708882bd7953aeae`, strict shared/domain adapters, current-storage resolver, generic BR-046 snapshot conversion, and ten focused tests bind nine reviewed Feature providers to current effective unsuppressed parameter-complete instances, canonical/runtime hashes, typed values, exact checkpoints, and one dependency per canonical provider. `Dilettante` now grants `Breeder` only through its exact Feature source, waives the Edge Skill prerequisite, and uses a synchronous server-owned General Education/Perception substitution that is folded into authority and projected by the DC 12 check. `Playing God` exposes bounded potential artificial-Egg evidence without spending or creating an Egg; hatch-special Feature evidence remains non-executable without persisted use consumption, while fossil and learning reducers remain gated to BR-065/068. The absent facility registry accepts only no claims. Malformed, unresolved, suppressed, stale, enriched, accessor-backed, drifting, throwing, or Promise-like authority fails without mutation. Feature/Edge/check/snapshot/Egg-production regressions, typecheck, targeted lint, checker, and current-source validation pass.
- [x] **BR-062 — Integrate item, Ability, capability, move, Nature, form, and campaign override contributions** — `DONE`
  - Evidence: Modifier-provider handoff contract `e83ff486ab6791d3116fe298ad03c3d2dfb536d92287b5dfa7fceb01bb332066`, closed runtime policy `dfc8ee1d4860eed79e7dfa78d8b3cab7b43dda1f3752149e2213ef47e0ab6a70`, and storage schema v25 `8b0a56b7ca7f7572549ecc95ec1170bbc557986d664c44dd35641a545bfa9404` bind canonical app-owned item, Ability, Capability, Move, Nature, form, core-rule, campaign-option, and server-offer authority to exact current storage revisions, effective unsuppressed projections, mechanic hashes, custody, typed values, read-set dependencies, and `clientAuthority: none`. Serpent’s Mark freezes one reviewed parent pattern with a persisted d2 only when two current patterns differ; one quantity-backed Egg Warmer item unit continuously doubles campaign-time progress for at most four assigned Eggs; and one current Egg Warmer Capability source persists one command-bound d10 per 1,440 campaign minutes and credits target-equivalent progress without mutating the immutable target. Production now supports fixed, persisted server-random, and bounded GM hatch durations; canonical Move provenance, Nature, and compiled/form-offer boundaries remain frozen; child construction rebuilds Loyalty rank 3 and one Tutor Point from app-owned rules and strips provider evidence from player projections. Parental Bond/Marsupial, fossil tools, and inherited-Move application remain evidence-only for BR-067, BR-065, and BR-068. Atomic rollback/restart/retry, stale authority, cooldown, malformed provider, privacy, migration parity, and no-redraw coverage pass across 438 focused Breeding checks, plus current typecheck, checker, and targeted lint.
- [x] **BR-063 — Define parent evolution, trade, rename, folder move, deletion, retraining, and source-update behaviour after project and Egg checkpoints** — `DONE`
  - Evidence: Parent/source change contract `102dc4a7109d6774cbb163c66b89732df5c716a9bf0ca667ce21ad01840e7a07`, closed runtime policy `312be56adce3af78847b38c8934bc2b2818e75d38738562eb9c49ff8e57e0e84`, strict shared evidence/impact parsers, and pure authoritative evaluators bind evolution, trade, rename, folder movement, deletion, retraining, and source-reference updates to exact server-observed before/after storage facts, current reference snapshots, semantic deltas, and `clientAuthority: none`. Before the check, only same-identity evolution/folder/retraining changes may use explicit interruption, preserving credited time while requiring a strictly newer revision, full compatibility/provider revalidation, and fresh consent; rename/trade/deletion/reference changes require cancellation/new setup or a reviewed migration. Every post-check change blocks accrual and production without erasing audit credit. Settled/terminal Projects remain closed, while accepted Eggs preserve parent snapshots, blueprint, provider traits, incubation, readiness, and status-derived hatch eligibility without live-parent lookup. Eight focused matrix/adversarial cases and the 446-test Breeding checkpoint pass with typecheck, targeted lint, checker, immutable-fixture coverage, and source-loss privacy guidance.
- [x] **BR-064 — Implement Egg ownership transfer, gifting, storage, consent, and privacy lifecycle** — `DONE`
  - Evidence: Egg-transfer contract `8f147a391693d712cd2e66423536236ad19007db1b0a882f0e1b81a2a5c2b3f8`, closed runtime policy `eb2bcbf2237a13a3fa3d8ce60583c5868fc4bf49c2478ac27da5a055664d0da5`, operation contract `f9f31c1b2d135d8fc342f69c966399f5dc901d60df25dadcae9601df0dc3fbbd`, and byte-equivalent storage schema v26 `c5426224c9448a95eb8074559c3b292c31aabaf08187012f08de9c4cd7b85c36` implement durable linked `source-gift` and `recipient-acceptance` records, current Profile/Trainer control validation, campaign-time expiry at equality, and coarse participant-only projections. Transfer execution rebuilds both controls, exact Egg/Trainer/consent/read-set/dependency authority, and permits authenticated GM execution only after both positive consents; GM authority never substitutes for consent. One BR-037 transaction consumes both consent revisions, changes only Egg ownership metadata, settles the operation, and appends payload-free former-owner/new-owner refreshes. Rollback retains only recoverable phase-one evidence, terminal retries do not revise or republish, storage remains non-mutating and does not pause incubation, and accepted mechanics remain byte-equivalent across transfer. Eight focused consent/privacy/replay/failure cases and the 60-file, 463-test Breeding checkpoint pass with typecheck, targeted lint, checker, and migration parity. Every full current-source quality-gate stage passes; after the first E2E production build was resource-killed, the E2E and final build tail passed singly under the bounded 3 GiB Node heap without changing source.
- [x] **BR-065 — Implement fossil-created Eggs through the shared Egg and hatch pipeline** — `DONE`
  - Evidence: Fossil-Egg contract `2cd3155fd9dd8aec6f7fce205e2e88af68e765bb195f228abd0d347ccfe5b600`, closed runtime policy `e7bda94a6c53fec33801eb6de3b106665237a3d6a730c9ed457074999c0a4f36`, and operation contract `528606ac59cf614d8000acd91fe8e1efecb056ffa430d91f42b975a1e25492a7` route `source.kind = fossil` into the ordinary durable Egg aggregate. Current authenticated GM designation binds one exact quantity-backed fossil row/unit; settlement rebuilds one effective unsuppressed parameter-ready Paleontologist, both prerequisite Skill ranks, one distinct exact Reanimation Machine row/unit, current Features/options/references, deterministic command-bound offers, and optional persisted duration randomness. Parentless blueprints default to Level 10, no Breeder, and no implicit inheritance. Fossil Restoration spends two Tutor Points and freezes the other Basic or one bounded Advanced Ability; Prehistoric Bond requires Restoration plus Expert Pokémon Education and freezes the unique or bounded-tie Nature-adjusted highest-stat fossil-only Held Item. One BR-037 transaction consumes exactly one fossil unit, leaves the machine intact, consumes selected offers, inserts the shared Egg, settles the operation, and appends restricted refresh rows. Rollback/recovery, exact retry after later revisions, malformed/accessor-like input, Promise-like providers, stale source/tool/Feature authority, tie offers, privacy, and ordinary child construction are covered by 12 focused cases. The 62-file, 478-test Breeding checkpoint, typecheck, targeted lint, checker, and the complete current-source quality gate pass; no parallel incubation, hatch-special, child, lineage, acquisition, or completion path exists.
- [x] **BR-066 — Implement GM-created, mysterious, gifted, and imported Eggs with typed provenance** — `DONE`
  - Evidence: GM-Egg contract `81a14542ce85b3342b8bf4e710aa3fe73c8502d2fb14de85581172b518fae6b6`, closed runtime policy `b2814d34d21cf85eba2f1b0974b0cb24025b8772cd0d2f9bcf1751a3edcef90b`, extended Egg contract `d618bb99af274a1eb4feb2c3e8c827b3080d5980e867d1b2958d013699693a09`, and operation contract `c3945dfc69769a45d73273d424bfd3e0926669c2ea49af3a0cfaa47a2f915e8a` route GM-authored, mysterious, direct campaign-gift, and reviewed imported origins into the ordinary parentless `PokemonEggDocumentV1`. Every new `source.kind = gm` record carries a closed self-hashed provenance bound to the future Egg, exact owner Trainer revision/document, creating GM Profile, campaign checkpoint, kind-specific reason, and—only for imports—the current server-reviewed source record, receipt, and full evidence hashes. Historical three-field GM sources remain readable but cannot authorize creation; later player gifts continue through BR-064 dual consent and preserve source/blueprint byte-for-byte. Deterministic command-bound offers freeze Species, Nature, Basic Ability, legal Gender, optional canonical inheritance, authoritative base duration, and any GM duration target; random duration persists exactly one operation-local roll before reduction. The Level 1 Egg has no parents, Breeder, implicit inheritance, provider traits, Baby Template, or parallel hatch path. One BR-037 transaction consumes offers, inserts the Egg, settles the operation, and appends four payload-free refresh rows without mutating the Trainer; rollback/recovery and terminal retry never redraw or republish. GM may see only the coarse provenance class, while owner creation output redacts class/import state and all source evidence. Eight focused cases cover all four origins, import drift, strict/coercive/legacy rejection, provenance tampering, atomic rollback/recovery, silent retry, privacy, and transfer preservation. The 63-file, 486-test Breeding checkpoint, targeted lint, typecheck, checker, and complete 1,226-file/9,505-test current-source quality gate pass, including 26 Playwright cases and the production build.
- [x] **BR-067 — Implement the optional Baby Template and staged recovery without mutating species reference data** — `DONE`
  - Evidence: Baby Template/artificial-Egg contract `366a86c69d20b1822d8740c799578dc2072b4ed64cb66cbe67d5cfac95d1290f`, optional-offspring contract `298b4dcc956099a4d7428df17ef80a5842ba31f91b865efeca7ed127cb265682`, modifier handoff contract `286ccffed06f9d8f8f2a3ce3771a2cda54c204c5473bf256dc07e34e6ec8c19a`, and runtime policies `9efae47e792f62a4bd2203cb776c4d864dd6f64a89d78fca948800b55e6afc93` (Baby Template), `19959b7b640f7c53dfebb4e78612911bfdb77c84029f6e575a1e82172498280c` (Playing God), and `d3fd3006a889f09e3c54a7ca29906b13c2aceeaac466f1148350f613f1939a9f` (fossil) bind every optional decline/application value to exact server evidence, canonical size, and the frozen campaign-option snapshot across ordinary, fossil, GM, and artificial Eggs. Child derivation applies typed Base Stat, Skill, Capability, size, and growth effects with five-Level staged recovery without writing Species JSON; editable or forged sheet/private fields cannot create, reactivate, reverse, or influence authority. Playing God now creates the shared Level-5 Egg only after current Feature, Chemistry Set, $3500, bounded upgrade, persisted Gender/duration, transaction, recovery, privacy, and replay checks. Kangaskhan instead freezes forced Marsupial minus five, atomically establishes one reciprocal mother pouch at hatch, removes it at Level 25, and accepts only current effective Parental Bond for action, independent deployment/recall, capture-protection removal, 10-metre tether, and Damage Reduction exceptions. The BR-068 Level-20+/learning boundary remains unavailable. Sixteen focused files/158 checks plus four live-play Marsupial checks pass. The complete current-source gate also passes with 1,228 Vitest files/9,527 tests, four Nuxt tests, 26 single-worker Playwright cases, lint, typecheck, metadata/contract/hash checks, and the production build.
- [ ] **BR-068 — Integrate frozen inheritance candidates with level-up learning, errata prerequisites, move slots, and permanent-move provenance** — `IN_PROGRESS`
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
