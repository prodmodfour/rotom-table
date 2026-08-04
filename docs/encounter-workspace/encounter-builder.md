# Encounter Builder and recipes

The GM-only `/encounters/new` route is the Workshop authoring flow for a new encounter. It replaces the old roll-and-download workflow as the primary route from Play and Encounter Tables. The low-level generation API remains an implementation dependency for generated Pokémon sheets.

## Authoring flow

1. Choose one of the canonical recipes.
2. Choose a battlefield and encounter table.
3. Roll a cast, lock keepers, reroll unlocked rows, or replace a row's species and level.
4. Assign each row an existing battlefield side, a presentation role, and initial hidden state.
5. Review public stakes, GM-only stakes and notes, stage style, tactical default, and whether initiative starts at round one.
6. Launch once into the Battle Cockpit.

The launch request contains reviewed species, levels, source rolls, side IDs, cast roles, visibility, and presentation metadata. It does **not** contain action commands, damage, target legality, sheet authority, or mechanics acceptance. Generated sheets and final mechanics remain owned by their existing server use cases.

## Canonical recipes

Runtime recipe authority is `data/encounter-workspace/encounter-recipes.json`. `shared/encounterDocuments/recipes.ts` parses it as a closed, bounded contract and requires every identity exactly once.

| Recipe | Initial cast treatment | Document scaffold |
| --- | --- | --- |
| Trainer duel | standard, visible | match objective |
| Wild pack | standard, visible | calm/capture/retreat objective |
| Ambush | minion, hidden | survive/turn objective |
| Swarm | minion, visible, larger default count | breakthrough objective |
| Boss | boss, visible, boss stage | objective, escalation clock, opening/final phases |
| Hunt or capture | leader, hidden | capture objective and GM trail clock |
| Chase-ready | leader, visible, chase/split presentation | pursuit objective, escape clock, pursuit/final phases |
| Blank | standard, visible | no story scaffold |

Recipe state is editable after launch through revisioned Director commands. Templates provide authoring defaults only; they do not infer initiative, target legality, movement, damage, or any other mechanic.

## Atomic launch and retry

`launchEncounterBuilderUseCase(...)` uses the existing map write queue and one SQLite transaction for:

- generated Pokémon sheet rows;
- final collision-safe sheet identities and folders;
- battlefield placements and reviewed side IDs;
- optional calculated initiative start across the authoritative placed cast;
- the first-class encounter document;
- the immutable launch receipt; and
- durable map/sheet realtime events.

Every reviewed cast row must generate the reviewed species/level and receive a valid placement. Initiative uses the existing sheet-derived ordering utility and is started only when explicitly selected; a battlefield with active initiative rejects that choice. An unknown side, mismatched or failed generation, unavailable location, revision conflict, document conflict, initiative conflict, or durable-event failure rolls back the complete launch. A successful `launchId` stores the hash of the exact closed request. Retrying identical intent returns the same receipt; reusing the ID for changed intent fails with `409`.

## Privacy

Initial hidden participant IDs, GM stakes, GM clocks, and notes are stored in the encounter document and removed by server projection for unauthorized viewers. Cast roles are presentation metadata. Client CSS is never the privacy boundary.
