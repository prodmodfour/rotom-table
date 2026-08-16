# Evolutionary Item workflow

P8-055 implements all 24 canonical Evolutionary Stones and Keepsakes as one server-authoritative, irreversible sheet workflow covering 62 reviewed transitions.

## Authority

Runtime mechanics consume only:

- `data/reference/items.json` for item identity;
- `data/reference/rules.json` → `Evolutionary Items.itemEvolutionMechanics` for transition and settlement policy;
- `data/reference/pokedex.json` for exact species, Base Stats, Types, Abilities, Moves, Skills, Capabilities, and evolution-family data.

`data/complete-play-loop/evolution-items.v1.json` binds those records, the reviewed migration, all transition/spec fingerprints, and source excerpts. Documentary Markdown is migration provenance only and is never parsed at runtime.

## Declaration and eligibility

A Trainer may use an owned Evolutionary Item on exactly one Pokémon owned through the authoritative roster. The server rechecks:

- exact source row, quantity, and revision;
- actor control and Pokémon ownership;
- current Pokémon revision and immutable evolution provenance;
- exact source species, minimum Level, and any gender restriction;
- one opaque authority-projected destination (including both Clamperl branches);
- one exact irreversible confirmation;
- absence of unresolved evolution Stat allocation.

The preview exposes only owner-safe facts: before/after species data, canonical Ability mapping, retained identity, resulting Stat budget, bounded new-form Move opportunities, Capability/Skill update policy, and equipment compatibility. IDs, hashes, source evidence, row identities, and raw provider reasons remain private.

## Atomic acceptance

An accepted operation commits together or not at all:

1. consume exactly one source item;
2. retain sheet/character, nickname, ownership, Level, Nature, history, and current Moves;
3. change to the reviewed destination species;
4. derive destination Base Stats, Types, Skills, and Capabilities from canonical data while preserving explicit overrides;
5. map each current canonical Ability by exact tier and slot;
6. reset Added Stat Points to zero and expose the exact full re-stat budget;
7. expose only new-form Moves below the transition minimum Level that the source form could not learn and that are not already known;
8. reconcile active equipment against the destination species and mark incompatible sources inactive;
9. append immutable private application evidence and an owner-safe attention projection.

Retries with the same operation identity exact-replay the accepted result. Choice, sheet, definition, source, ownership, or campaign-read drift rejects before any write.

## Follow-up and setup-save protection

`PokemonEvolutionAttentionCard.vue` keeps Stat, Move, Ability, and equipment consequences visible on the Pokémon sheet. Species and mapped Ability rows are read-only. While Stat allocation is open, Level and Nature are also read-only.

Setup saves preserve private evidence and reject species, Ability, budget, Level, or Nature tampering. Partial legal allocations remain visible. When the full exact budget satisfies current Base Relations, the server appends one deterministic Stat-resolution receipt and projects the work as resolved. Browser payloads cannot mint or rewrite either receipt.

## Privacy and realtime

Player and GM-facing sheet projections omit `serverPrivate.itemEvolution`. Realtime sheet events use the same redaction boundary. The public projection contains only the transition and actionable follow-up labels; it never includes operation IDs, source instances, hashes, canonical row evidence, or raw equipment compatibility internals.
