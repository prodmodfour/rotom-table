# Pokémon Contest canonical-data maintenance

## Sources and generated targets

The reviewed manifest is `scripts/reviewed-data/pokemon-contests.v1.json`. It pins documentary source SHA-256 values and decisions, including worked-example conflicts. The migration owns:

- `data/reference/contests.json`;
- structured `contest` identity on every row in `data/reference/moves.json`;
- reviewed Contest item mechanics in `data/reference/items.json`.

Run:

```bash
python3 scripts/migrate_pokemon_contests.py --check
npx vite-node --config vitest.config.ts scripts/generate_contest_variant_fixtures.ts
```

To intentionally regenerate reviewed outputs after source review:

```bash
python3 scripts/migrate_pokemon_contests.py --write
npx vite-node --config vitest.config.ts scripts/generate_contest_variant_fixtures.ts --write
```

Never regenerate merely to silence drift. Review source/hash/decision changes first.

## Coverage artifacts

`data/contests/` records the footprint, completion rubric, rule coverage, provider integration coverage, privacy roles, aggregate UX criteria, failure/recovery cases, documented Cute replay, and the 18-scenario type/scale/variant matrix.

Every Move ends in `defined` or explicit `unavailable`; current reviewed counts are 761 and 16. All canonical effect IDs must be represented. All 34 Features, 2 Edges, 3 Abilities, and 5 item identities (the four referenced tools plus standalone Poffin) have exactly one final state and no blocked row.

`tests/data/contestCoverage.test.ts` fails on count, identity, effect, source hash, atomicity, fixture, or documentary-runtime import drift.

## Created Moves

Innovation and Dance-created Moves may not exist in `moves.json`. A GM uses `bind-created-move` to attach type/effect evidence to that exact Pokémon Move row. Passing Waltz is constrained to Get Ready!; Beguiling Dance is constrained to Excitement. Setup saves cannot forge operation-owned bindings. Unbound created Moves remain visible but unavailable.

## Conflict policy

When documentary examples conflict with canonical tables, retain both as fixture comparison and a numbered reviewed decision. Runtime follows the structured reviewed result. Do not add implicit aliases, neutral dice, or score patches in engine code.