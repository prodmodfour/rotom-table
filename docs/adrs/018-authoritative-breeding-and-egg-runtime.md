# ADR 018: Authoritative breeding and Egg runtime

- Status: Accepted
- Date: 2026-08-04
- Ruleset: `ptu-1.05-breeding-v1`
- Ownership map: `breeding-runtime-ownership-v1`

## Context

Rotom Table needs durable breeding projects, first-class Eggs, campaign-time incubation, and exactly-once hatching. Existing sheet fields, a documentary generator, and map metadata can mention Egg concepts, but none is a valid aggregate or lineage authority. The runtime must also consume upstream Edge, Feature, Ability, Capability, item, and campaign-rule providers without copying their ownership.

The source and conflict decisions are frozen by ADR 017. This ADR assigns runtime ownership and integration boundaries.

## Decision

### Aggregate boundary

A breeding project, parent consent, Egg-transfer consent, Pokémon Egg, breeding operation result, campaign clock, and species-acquisition record are separate durable campaign records. An Egg is not a Pokémon sheet, Trainer roster row, inventory item, map record, encounter participant, or status condition.

There remain exactly two sheet kinds: Trainer and Pokémon. A Pokémon sheet is created only by the terminal hatch transaction.

### Layering

The runtime is split into:

1. `shared/breeding`: strict versioned contracts, canonical IDs, transitions, commands, public projection types, and pure JSON parsers.
2. `server/domain/breeding`: compiled reference access, pure compatibility and offspring rules, snapshots, provider composition, state planning, randomness requests, and audience projection.
3. `server/storage`: SQLite repositories for projects, Eggs, clock, operations, consent, and acquisition history, plus the existing sheet and realtime repositories.
4. `server/useCases`: authorization, complete read sets, expected-revision checks, operation replay, injected randomness, transactions, and post-commit publication.
5. `server/api/breeding`: exact request parsing and role-projected responses only.
6. `src`: Workshop presentation using public contracts and API clients; no mechanics inference or privacy filtering.

Runtime code consumes reviewed app-owned JSON and compiled breeding artifacts. It never interprets markdown or parser output.

### Upstream provider boundary

Edge automation owns effective Breeder and Paleontologist permission. Feature, Ability, Capability, item, and rule systems own their effective contributions. Breeding reads those providers at declared checkpoints and freezes contribution IDs, values, source identities, and definition hashes. It does not copy provider acquisition or suppression rules.

`edge.breeder.request.v1` terminates at the breeding authorization adapter. It does not itself create a project or Egg.

### Fossil source boundary

A fossil creates the same durable Egg aggregate and uses the same incubation, hatch-special, child, lineage, acquisition, and completion pipeline. There is no fossil sheet kind, inventory-row Egg, or parallel hatch command. The accepted source is `source.kind = fossil`, parentless, Breeder-free, and Level 10 by default, with no implicit inheritance.

Creation requires a current authenticated GM designation of one exact quantity-backed fossil source row/unit, one current effective unsuppressed `Paleontologist` Edge, its current Novice Pokémon Education or Survival prerequisite, and one distinct exact Reanimation Machine row/unit. All selectable traits come from command-bound server offers. Any hatch-duration random value is durable before reduction. The source unit is consumed atomically with Egg insertion; the machine is evidence and is not consumed.

`Fossil Restoration` and `Prehistoric Bond` remain Feature-owned permissions/contributions, while the fossil reducer owns their mechanics. Restoration spends two Tutor Points and freezes the only legal extra Basic or bounded Advanced Ability. Bond requires Restoration and Expert Pokémon Education, resolves the highest Nature-adjusted Base Stat, and freezes the corresponding fossil-only Held Item; only an exact maximum tie creates a GM choice. BR-067 layers its optional Baby Template choice onto this same source adapter without changing fossil ownership or creating another hatch path.

### GM-source provenance boundary

GM-authored, mysterious, direct campaign-gift, and imported origins create the same parentless durable Egg with `source.kind = gm`, no Breeder, and Level 1. Every new source contains a closed self-hashed provenance record bound to the future Egg, current owner Trainer, creating GM Profile, and campaign checkpoint. Imported origins additionally bind a current server-reviewed source-record and import-receipt hash. Historical three-field GM sources remain readable but cannot authorize creation. A later Trainer gift is BR-064 ownership transfer, not a source rewrite.

All GM-source traits and durations come from deterministic command-bound server offers; required random duration variation is persisted before reduction. One BR-037 transaction consumes selected offers, inserts the ordinary Egg, settles the operation, and appends payload-free refreshes without mutating the Trainer. GM may see the coarse provenance class; owner projections may not. These Eggs use the same incubation, hatch-special, child, lineage, acquisition, and completion path. BR-067 owns their optional-template extension and forced Marsupial specialization rather than changing BR-066 provenance ownership.

### Baby Template, Marsupial, and artificial-source boundary

Baby Template is a frozen server-owned overlay over app-owned Species data, never a Species mutation. A campaign application is disabled by default and, when enabled, requires one policy-bound server offer that freezes a 2–4 Base Stat penalty, typed Skill/Capability/size effects, and five-Level recovery. Marsupial alone forces penalty 5 through Level 24. Editable sheet fields and player-supplied private data cannot establish, erase, or reactivate authority.

Kangaskhan hatch completion rebuilds current Marsupial and optional Parental Bond authority from one adult mother and commits the child plus reciprocal pouch records atomically. Marsupial's no-action and pouch-protection rules apply only to its active template; current effective Parental Bond permits action and departure while retaining the reviewed tether and Damage Reduction. Level 25 clears the durable relationship without rewriting Species authority.

Playing God creates `source.kind = feature-artificial` through the same Egg and hatch pipeline. Its dedicated reducer requires current Feature parameters, exact Chemistry Set custody, an atomic $3500 cost, persisted required randomness, and exactly rank-bound Expert/Master upgrades. The handoff alone mutates nothing, the tool is not consumed, and retries neither redraw nor spend twice.

### Transactions

Project mutation, Egg production, Egg ownership transfer, campaign-clock advancement, and hatching each have one SQLite transaction. Every transaction includes its terminal operation result and durable audit/realtime event records. Events publish only after commit.

Ownership transfer requires durable, linked positive consent from both the current source Trainer controller and the targeted recipient Trainer controller. Consent is bound to the exact Egg and Trainer revisions and expires under campaign time at equality. GM authority can execute but cannot replace consent. The transfer transaction consumes both consent records, advances only Egg ownership metadata, settles the operation, and appends former-owner/new-owner refresh rows atomically; storage movement itself remains non-mutating and does not pause incubation.

The hatch transaction atomically revision-checks the Egg, records or reuses the special roll, resolves bounded adjudication, allocates and inserts one complete Pokémon sheet, updates one Trainer roster, inserts species-acquisition history, conditionally grants the first-species reward, marks the Egg hatched, stores the operation result, and appends events.

A duplicate or concurrent command returns the stored child identity. It never constructs another child.

### Campaign time

A versioned campaign clock owns integer campaign minutes and monotonic revisions. Project and incubation advances use stable advancement IDs. Process time, browser time, time zones, map scenes, and real-time timers have no mechanic authority.

### Privacy and realtime

Repositories and use cases project separate public, owner, participating-owner, GM, and diagnostic schemas. Visibility is established before control. The browser never receives an over-broad payload to hide with CSS.

Realtime contains bounded refresh identity, revision, operation kind, and audience scope only. It carries no parent, sheet, consent, roll, trait, choice, lineage, note, or command payload.

### Legacy boundary

The following remain compatibility presentation or migration inputs only:

- `CharacterSheet.eggGroups`;
- `CharacterSheet.eggMoves`;
- `CharacterSheet.inheritedMoves`;
- editable Gender, Nature, Ability, and `babyTemplate` fields;
- `ptu-data/generator.py` and its emitter.

`map.metadata.capabilityEggs` and map-scoped Egg Warmer mutation were conflicting legacy authority. Egg Warmer now contributes only through the typed `apply-egg-warmer-capability` Egg operation; BR-089 removed every production map reader, writer, offer, selector, and mechanic branch. Historical keys remain quarantine-only diagnostics. Normal breeding never depends on a map route, scene, placement, initiative, or interaction mode.

### Recovery, backup, and source updates

Accepted outcomes store ruleset, source, compiled-spec, provider, and operation hashes. Parent changes after acceptance cannot rewrite the Egg. Export and restore preserve IDs and validate references, operation uniqueness, child links, acquisition uniqueness, and ruleset availability before accepting data.

A source update requires a reviewed source-hash-bound migration and a new definition hash or ruleset version. Existing Eggs continue under their frozen definitions.

## Consequences

- There is one writer for every fact and one child-construction path.
- Projects and Eggs survive restart, reconnect, transfer, parent changes, and source updates.
- The Workshop can evolve independently from mechanics while remaining role-safe.
- Map and encounter systems do not acquire campaign breeding responsibilities.
- More repositories and transaction tests are required, but duplicate authority and partial hatch states are structurally prevented.
