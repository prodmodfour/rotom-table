# ADR 017: Versioned breeding ruleset and source adjudications

- Status: Accepted
- Date: 2026-08-04
- Ruleset: `ptu-1.05-breeding-v1`
- Definition SHA-256: `ab778e2ca678e8f823b78c2f2bec883ec6796b730d4996e24e5c07d40f6fea02`
- Source manifest SHA-256: `fddf4a3cb4a3806eab4e65b6b8090a0cc42beb261353060b8d9492806d965bb7`

## Context

Rotom Table has app-owned Pokémon, Move, Ability, Edge, Feature, item, Capability, and rule references, but it does not have an authoritative breeding aggregate. Existing Pokémon sheet fields and the documentary wild generator can display or generate Egg Moves, yet neither records parents, consent, source revisions, rolls, lineage, or exact retry evidence.

The checked-in provenance also contains rule conflicts and incomplete data that cannot be interpreted at runtime. These include the core parent-family d20 procedure versus maternal-line wording, undefined maturity, Ditto and genderless cases, mixed Egg Group vocabulary, malformed evolution targets, missing hatch rates, optional hatch variation and Baby Template rules, a non-automatic special hatch result, fossils, and inheritance prerequisite errata.

A deterministic runtime therefore requires one reviewed ruleset and explicit fail-closed adjudications before offspring resolution is implemented.

## Decision

### 1. Authority and versioning

`data/breeding-automation/ruleset.json` is the reviewed versioned policy artifact. Its `definitionSha256` hashes the canonical stable JSON of its `definition` object. Every accepted project and Egg will freeze:

- `rulesetId`;
- the ruleset definition SHA-256;
- the source-manifest SHA-256;
- effective campaign-option values;
- consulted compiled-spec and provider definition hashes.

Only app-owned `data/reference/*.json` and reviewed generated artifacts may feed runtime semantics. Markdown, parser code, legacy parser output, books, PDFs, websites, and wikis are provenance or maintenance inputs only. Runtime prose interpretation is forbidden.

Unknown, malformed, contradictory, or unresolved data returns a stable unavailable result. It is never supplemented from documentary material or a client value.

### 2. Parent compatibility and family selection

The default conventional pair has one female-role parent and one male-role parent sharing at least one compiled Egg Group. Maturity requires an explicit GM confirmation per parent because no universal source threshold exists. A campaign may instead freeze a bounded minimum Level.

Only canonical species ID `ditto` receives the either-role rule. Ditto never supplies the offspring family and Ditto with Ditto is incompatible. Other genderless Pokémon are unavailable by default. Same-sex and genderless exceptions require a typed, audited GM role override.

After compatibility, one persisted server d20 selects the family:

- 5–20: female parent family;
- 1–4: male parent family.

The selected family is then resolved through a reviewed compiled family/form graph to one lowest-stage species. The maternal-line wording is applied as lowest-stage resolution and does not replace the core d20 selector. Ambiguous, cyclic, alias-only, or malformed roots are unavailable unless a source-bound GM species override is enabled and recorded.

### 3. Traits and inheritance

Nature uses a persisted 2d6 roll unless an effective breeder with at least Adept Pokémon Education chooses from server-issued canonical Nature options.

Ability resolves from canonical Basic Abilities only. It uses a persisted uniform roll unless an effective breeder with at least Expert Pokémon Education chooses a server-issued option.

Gender uses a persisted d100 against the compiled female percentage unless an effective breeder with Master Pokémon Education chooses a server-issued legal option. Genderless is a distinct canonical result.

Inheritance candidates are built from each parent's effectively known canonical Moves at the reviewed snapshot checkpoint. A Move qualifies only when it appears on the resolved child species' Egg Move list or machine-compatible list. Candidates deduplicate by canonical Move ID while retaining every parent and pathway source.

Inheritance checkpoints are Levels 20 through 100 at ten-Level intervals. Errata prerequisites apply at each checkpoint. An illegal candidate leaves that checkpoint empty and remains available for a later legal checkpoint; the runtime does not silently backfill or discard evidence.

### 4. Time, incubation, and hatching

A normal Breeder project requires 240 campaign minutes, one authoritative DC 12 Pokémon Education check, and 240 additional campaign minutes after success. The default permits one check per project. Failure creates no Egg and is terminal for that project; a retry requires a new project and operation identity.

Recognized `N Days` hatch values compile to exact campaign minutes. The default duration is the fixed species average. Campaigns may choose one replay-safe random multiplier or one audited GM value bounded from one-half to twice the average. Missing or malformed hatch time is unavailable unless a bounded, typed GM duration override is frozen on the Egg.

The hatch-special d100 is rolled once. Results 1 and 100 open a bounded GM adjudication by default. They do not automatically set `shiny: true`. A campaign may use a reviewed bounded outcome table instead.

The optional Baby Template is disabled by default. If enabled for an Egg, its 2–4 Base Stat penalty and all skill, Capability, size, and growth effects are typed and frozen. The existing editable `babyTemplate` field is not origin evidence.

### 5. Fossils and other Egg producers

Fossils, GM-authored Eggs, and Feature-produced artificial Eggs use the same durable Egg lifecycle with explicit source kinds. Fossils hatch at Level 10 by default, use bounded GM trait choices, and have no parent inheritance unless a bounded canonical list is explicitly supplied.

Provider-specific timing, Level, cost, trait, use, or upgrade effects are authoritative contributions snapshotted by `breeding.v1`; they do not create parallel Egg persistence or hatch implementations.

### 6. Campaign options

The closed option registry in `ruleset.json` defines IDs, kinds, defaults, allowed values or bounds, GM-only status, activation conditions, and snapshot checkpoints. Clients submit only server-issued option identities. They cannot submit mechanics, arbitrary patches, source prose, or executable values.

Changing campaign defaults never rewrites accepted projects or Eggs.

### 7. Existing code boundary

The baseline audit is frozen in `data/breeding-automation/baseline-audit.json`.

Reusable seams:

- effective Breeder ownership and `edge.breeder.request.v1` delegation;
- canonical app reference JSON;
- SQLite transaction, revision, operation-ledger, and complete sheet-insertion patterns;
- existing Trainer-to-Pokémon roster links after an atomic hatch.

Compatibility-only seams:

- `eggGroups`, `eggMoves`, `inheritedMoves`, Gender, Nature, Abilities, and `babyTemplate` on ordinary sheets;
- `ptu-data/generator.py` and its sheet emitter.

A conflicting legacy seam exists: Egg Warmer currently targets `map.metadata.capabilityEggs` and mutates `hatchHours` through a map-scoped command. This data is not accepted Egg authority. It must become a typed contribution to `breeding.v1`, after which the map metadata path is retired.

Eggs remain dedicated campaign aggregates; no third sheet kind is introduced.

## Consequences

- Breeding mechanics can be replayed and explained from immutable inputs and definition hashes.
- Source gaps reduce availability rather than producing guessed offspring.
- Some species remain unavailable until reviewed compiled-spec adjudications are added.
- Existing manual sheet data remains visible but cannot manufacture lineage.
- Campaign flexibility is preserved through bounded, typed, snapshotted options.
- Normal breeding and hatching remain independent of maps, scenes, initiative, placements, and browser timers.
- Future source changes require a reviewed source-hash-bound migration and a new definition hash or ruleset version.
