This is a Nuxt 4 and three.js project.



## Validation and resource discipline

This workspace has limited shared memory. Repeated or concurrent TypeScript, Vitest, Vite, Nuxt, and build processes can exhaust it.

- During implementation, prefer focused tests for the behavior being changed. When practical, constrain Vitest with `--maxWorkers=1 --no-file-parallelism`.
- Batch related changes before typechecking. Run typecheck at meaningful integration milestones and once near final acceptance rather than after every edit.
- Reserve the full test suite, production build, and `scripts/quality-gate.sh` for closure unless a broad run is specifically needed to diagnose an integration failure.
- Do not rerun an already-passing suite unless its relevant dependency surface changed. Keep track of validated commands and results across handoffs.
- If memory pressure or an OOM occurs, stop duplicate validation processes, inspect active processes, and resume with one bounded command at a time.

## Liveplay
This is a lvieplay only app. Local hosting is deprecated. All features implemented should work for liveplay.

## Authoritative PTU reference data

Treat these app-owned files as the canonical runtime reference sources:

- `data/reference/moves.json`
- `data/reference/abilities.json`
- `data/reference/edges.json`
- `data/reference/capabilities.json`
- `data/reference/features.json`
- `data/reference/conditions.json`
- `data/reference/items.json`
- `data/reference/maneuvers.json`
- `data/reference/pokedex.json`
- `data/reference/stat-rankings.json`
- `data/reference/pokemonExperienceChart.json`
- `data/reference/rules.json`

The similarly named files under `ptu-data/data/` are documentary/parser output, not runtime sources of truth.


