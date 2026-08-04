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

A breeding project, parent consent, Pokémon Egg, breeding operation result, campaign clock, and species-acquisition record are separate durable campaign records. An Egg is not a Pokémon sheet, Trainer roster row, inventory item, map record, encounter participant, or status condition.

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

### Transactions

Project mutation, Egg production, campaign-clock advancement, and hatching each have one SQLite transaction. Every transaction includes its terminal operation result and durable audit/realtime event records. Events publish only after commit.

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

`map.metadata.capabilityEggs` and map-scoped Egg Warmer mutation are conflicting legacy authority. Egg Warmer becomes a typed contribution to the Egg use case, then the map metadata path is removed. Normal breeding never depends on a map route, scene, placement, initiative, or interaction mode.

### Recovery, backup, and source updates

Accepted outcomes store ruleset, source, compiled-spec, provider, and operation hashes. Parent changes after acceptance cannot rewrite the Egg. Export and restore preserve IDs and validate references, operation uniqueness, child links, acquisition uniqueness, and ruleset availability before accepting data.

A source update requires a reviewed source-hash-bound migration and a new definition hash or ruleset version. Existing Eggs continue under their frozen definitions.

## Consequences

- There is one writer for every fact and one child-construction path.
- Projects and Eggs survive restart, reconnect, transfer, parent changes, and source updates.
- The Workshop can evolve independently from mechanics while remaining role-safe.
- Map and encounter systems do not acquire campaign breeding responsibilities.
- More repositories and transaction tests are required, but duplicate authority and partial hatch states are structurally prevented.
