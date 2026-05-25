# Performance benchmark fixtures

Track 1 benchmark runs need repeatable map data that does not expose a real campaign. Use the fixture generator below when you want local maps that match the empty, typical, and stress scenarios from [Performance benchmark scenarios](performance-benchmark-scenarios.md).

The generated maps are deterministic and use only committed example Pokémon sheets under `data/sheets/examples/`. They write to `data/maps/track-1-benchmarks/`, which is ignored by git as local map data. Do not commit generated map JSON files.

## Quick start

Preview the maps without writing files:

```bash
node scripts/generate_benchmark_maps.mjs --dry-run
```

Generate or refresh the local fixture maps:

```bash
node scripts/generate_benchmark_maps.mjs --overwrite
```

Then run the app in development mode, open the maps in the `track-1-benchmarks` folder, and append `?debug=render`, `?debug=render-metrics`, or `?debug=isometric-render` to the map route when collecting overlay values. Follow the [Performance benchmark runbook](performance-benchmark-runbook.md) when recording before/after measurements.

## Generated fixtures

| File | Scenario | Shape | Contents |
| --- | --- | --- | --- |
| `data/maps/track-1-benchmarks/benchmark-empty-map.json` | Empty map | `8×3×8` | Flat public test floor, no tokens, no hazards, no field effects. |
| `data/maps/track-1-benchmarks/benchmark-typical-map.json` | Typical campaign map | `18×5×14` | Mixed terrain/elevation, 8 public example Pokémon tokens, 6 hazards, weather, terrain, and room effects. |
| `data/maps/track-1-benchmarks/benchmark-stress-map.json` | Stress map | `32×8×28` | Dense terrain/elevation, 48 public example Pokémon tokens, 40 hazards, multiple weather, terrain, and room effects. |

The script refuses to overwrite existing fixture files unless `--overwrite` is supplied. Use `--output <dir>` if you need a disposable output folder for inspection.

## Manual fixture checklist

If you cannot use the script, create local maps with the same privacy and reproducibility constraints:

1. Work only in ignored local map data (`data/maps/` or a local browser-created map folder).
2. Use synthetic names such as `Track 1 Benchmark - Typical Map`; do not use real campaign locations, NPC names, notes, secrets, screenshots, or private art.
3. Use committed/public example sheets from `data/sheets/examples/` for token placements.
4. Keep the three scenario shapes stable: empty/minimal, typical medium scene, and large stress scene.
5. Preserve normal visual quality: antialiasing, device pixel ratio, weather particles, field effects, sprites, shadows, cages, HP bars, overlays, hazards, and tools stay enabled.
6. Record any intentional differences from the generated fixture counts in the PR benchmark notes so before/after runs stay comparable.
7. Before committing code/docs, run `git status --short` and confirm no files under `data/maps/` or other private local data folders are staged.

## Updating the generator

When the benchmark fixture script changes, keep it deterministic and privacy-safe:

- use fixed timestamps and stable ordering so generated JSON diffs are meaningful;
- keep all sheet references on public `examples-*` slugs;
- update the generated-fixtures table above when dimensions, token counts, hazard counts, or effect counts change;
- run `npm test -- --run tests/scripts/generateBenchmarkMaps.test.ts` to validate the helper output.
