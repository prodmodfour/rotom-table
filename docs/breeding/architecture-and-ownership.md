# Breeding architecture and ownership

The executable ownership registry is `data/breeding-automation/ownership-map.json`. ADR 018 is the architectural decision; this document is the implementation map.

## Data flow

```text
app-owned reference JSON + reviewed breeding artifacts
  -> compiled species/family registry
  -> effective upstream providers
  -> authorized preview and server-issued choices
  -> durable project + consent + persisted rolls
  -> immutable Egg blueprint
  -> versioned campaign-clock incubation
  -> one atomic hatch transaction
  -> complete Pokémon sheet + Trainer link + acquisition history
  -> audience-specific Workshop projection + refresh-only realtime
```

## Fact owners

The invariant is one writer for every fact; all other integrations are readers or prohibited writers.

| Fact | Authoritative writer | Never a writer |
| --- | --- | --- |
| Canonical source facts | reviewed app-owned source migration | browser, markdown parser, `ptu-data/data` |
| Compiled species/family facts | breeding reference compiler | operation-time string parser |
| Effective Breeder permission | Edge automation | sheet label copy |
| Effective modifiers | owning provider + breeding adapter | free-form facility or client effect |
| Project | breeding project use case/repository | sheet or map repository |
| Consent | consent use case/repository | public flag, local state, note |
| Parent snapshot | project/Egg state planner | later live-parent reconciliation |
| Rolls/checks | persisted breeding roll ledger | `Math.random`, client, legacy generator |
| Egg | Pokémon Egg use case/repository | sheet, inventory, map metadata |
| Campaign time | campaign clock use case/repository | browser/process/map timer |
| Child sheet | atomic hatch use case through sheet repository | blank-create then follow-up save |
| Trainer roster link | atomic hatch use case through Trainer sheet | Egg roster or browser patch |
| Breeding origin | typed child origin written at hatch | `eggMoves`/`inheritedMoves` |
| Species acquisition | shared acquisition repository | `dexExp` inference |
| Projection | server audience projector | Vue/CSS filtering |
| Realtime | durable event log after commit | component or pre-commit publisher |

The full 22-row register, readers, prohibited writers, owner tickets, and existing/planned status are in the JSON map.

## Aggregate repositories

Planned dedicated repositories own projects, Eggs, campaign clock, operations, consent, and species acquisition. The existing sheet repository remains the only Trainer/Pokémon sheet store. Eggs do not add a sheet kind.

Repository methods accept a caller-owned SQLite connection when participating in a larger transaction. A use case, not a repository helper, owns the transaction boundary and complete read set.

## Transaction groups

### Project mutation

Project, consent effects, checks/rolls, operation result, audit event, and revision update commit together.

### Egg production

Project terminal transition, parent and provider snapshots, all offspring rolls and choices, Egg insert, operation result, and events commit together.

### Clock advancement

One clock revision, every affected project/Egg advancement, operation result, and events commit together. Duplicate advancement IDs return the stored result.

### Hatch

Egg transition, fully initialized child insert, Trainer box/team link, typed origin, acquisition history, first-species reward, operation result, and events commit together. A failure at any point rolls back every member.

## Dependency rules

- Shared contracts do not import server or Vue code.
- Pure domain code does not import routes or browser state.
- Storage does not import Vue or the map command executor.
- API routes do not issue raw SQL or interpret mechanics.
- Presentation does not import server domain code or reference JSON.
- Provider adapters consume effective projections and source hashes; they do not recreate acquisition logic.

## API and presentation

Campaign endpoints live under `/api/breeding`; Workshop routes live under `/breeding`. Responses are server-projected for exactly one audience. Normal operations have no map slug, encounter ID, placement ID, scene revision, or initiative dependency.

The Workshop may reuse Encounter design-system primitives, not Encounter authority. Its local state contains only view preferences and transient form selection that is revalidated against current server offers.

## Prohibited alternate authorities

- third sheet kind for Eggs;
- map-scoped breeding commands;
- inventory-row Eggs;
- lineage inferred from legacy fields;
- a second child generator;
- pre-commit realtime publication;
- client-side privacy filtering;
- runtime documentary parsing.
