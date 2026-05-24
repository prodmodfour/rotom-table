# Track 1 performance roadmap

Track 1 focuses on making the isometric map runtime more efficient on laptops with integrated or weak GPUs while preserving the same visible scene and table functionality. It is a performance and observability track, not a visual redesign or rules change.

## Goals

- Reduce avoidable CPU/GPU work while maps are idle or only receiving lightweight interaction input.
- Keep benchmark results reproducible across small, typical, and stress-sized maps.
- Add developer-only instrumentation so renderer, pointer, and pathfinding improvements can be measured.
- Preserve the existing Nuxt/Vue/Three.js architecture and strengthen module boundaries around isometric rendering utilities.
- Keep all player- and GM-facing map tools working: terrain editing, hazards, field effects, token controls, movement previews, targeting, HP/status overlays, initiative, and sheet interactions.

## Non-goals

Track 1 does not change multiplayer, persistence, authentication, campaign data ownership, PTU rules, or public hosting assumptions. It also does not replace the renderer or introduce a degraded low-quality mode.

## No-quality-loss rules

Performance work must preserve output-relevant scene state. Do not use any of these as the primary optimization path:

- lowering renderer device pixel ratio or canvas resolution;
- disabling antialiasing;
- reducing weather or field-effect particle counts;
- removing weather, terrain, shadows, cages, HP bars, overlays, sprites, hazards, or field effects;
- simplifying token controls, move automation, build tools, targeting, or sheet interactions;
- changing game rules to make rendering easier.

Acceptable improvements should avoid duplicate work instead: render only when dirty or animated, coalesce high-frequency input, reuse safe resources, cache deterministic computations, and add tests or documented guardrails for visual-equivalence assumptions.

## Benchmark map categories

Use benchmark maps that avoid private campaign data but still represent real workloads.

| Category | Purpose | Representative contents |
| --- | --- | --- |
| Empty map | Measures baseline renderer overhead and idle scheduling. | Minimal terrain, no or few tokens, default layers enabled. |
| Typical campaign map | Measures common GM/player play sessions. | Moderate terrain, several Pokémon/trainer tokens, shadows, HP/status overlays, hazards, field effects, and movement previews. |
| Stress map | Measures worst-case editor and combat interactions. | Large terrain, many voxels/tokens, multiple overlays/effects, weather, hazards, and repeated pointer/pathfinding interactions. |

For each category, compare before/after runs with the same browser, map data, zoom/camera position, layer visibility, and weather/effect state. Future benchmark notes should record both idle behaviour and pointer-heavy interactions.

## Staged optimization approach

### 1. Document constraints and add observability

Start by making the performance rules explicit, then add developer-only metrics for frame reasons, frame timing, renderer info, pointer/raycast counts, and pathfinding cache behaviour. Instrumentation should be hidden unless explicitly enabled for debugging.

### 2. Introduce render invalidation and scheduling

Move from unconditional full-frame work toward explicit dirty reasons and active-animation sources. Resize, camera controls, scene watchers, async texture loads, token style changes, and tab visibility changes should request renders through a scheduler while settled scenes stop producing duplicate idle frames.

### 3. Coalesce pointer-heavy interactions

Pointer movement can trigger hover updates, build/hazard previews, targeting, raycasts, and movement previews. Coalesce pointer input to at most one processing pass per animation frame, cache renderer bounds and picking lists, and short-circuit unchanged hover or preview anchors.

### 4. Cache deterministic movement/pathfinding work

Movement previews should reuse terrain indexes and path results keyed by selected token, start/goal, token dimensions, ground level, terrain revision, and placement revision. Cache invalidation must protect stale state when terrain, placements, dimensions, or selected tokens change.

### 5. Reuse renderer resources safely

Avoid disposing and rebuilding equivalent geometry, buffers, overlays, and target lists when semantic inputs are unchanged. Shared voxel/token geometries, movement preview line buffers, CSS3D dirty tracking, layer-visibility short-circuits, renderer size guards, and weather allocation reductions are preferred as long as particle counts, colours, opacity, and motion semantics remain equivalent.

### 6. Validate and audit

Finish with repeatable benchmark notes, resource cleanup coverage, and a no-quality-loss audit. Any optimization that changes output should be treated as a bug unless it is an intentional, separately reviewed product change.

## Validation expectations

Before sharing Track 1 changes, run the standard checks:

```bash
npm run typecheck
npm test
npm run build
```

When a ticket introduces pure utilities or cache invalidation, add focused Vitest coverage near the relevant code. Documentation-only changes should keep this roadmap and related docs accurate without changing runtime behaviour.
