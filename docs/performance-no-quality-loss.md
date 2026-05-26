# Map rendering no-quality-loss guardrails

This guide records the map rendering no-quality-loss guardrails. It checks whether the current performance implementation intentionally reduced visual quality or table functionality to claim performance gains.

## Outcome

**Pass:** no intentional visual-quality or functionality reduction was found in map rendering performance. The performance changes reduce duplicate work through dirty render scheduling, event coalescing, deterministic caches, unchanged-state short-circuits, and safe resource reuse. They do not add a degraded performance mode, lower renderer quality settings, hide map layers, reduce weather effects, or change PTU/map rules.

## Scope and method

Checked current map rendering performance documentation, benchmark notes, focused guardrail tests, and isometric renderer utilities, including:

- [Performance guardrails](performance-guardrails.md) and [Map rendering performance roadmap](map-rendering-performance-roadmap.md);
- [Isometric render scheduler architecture](render-scheduler-architecture.md);
- [Performance benchmark scenarios](performance-benchmark-scenarios.md), [fixtures](performance-benchmark-fixtures.md), [runbook](performance-benchmark-runbook.md), and [integrated benchmark pass](performance-benchmark-results.md);
- renderer quality, weather visual, render scheduler, pointer interaction, movement cache, voxel/token geometry, CSS3D HUD, layer visibility, and cleanup tests.

This is a code/docs/test check plus the integrated benchmark visual-equivalence notes. It is not a pixel-diff screenshot suite; future visual redesigns should be checked separately from map rendering performance-only work.

## Guardrail checklist

| Area | Result | Evidence |
| --- | --- | --- |
| Renderer quality | Pass | `ISOMETRIC_WEBGL_RENDERER_PARAMETERS` keeps WebGL antialiasing enabled and `resolveIsometricRendererPixelRatio` preserves browser DPR up to the existing cap. `tests/utils/isometric/rendererQuality.test.ts` guards both behaviours. |
| No degraded mode | Pass | Map rendering performance docs and implementation use debug-only instrumentation, not a user-facing low-quality/performance toggle. Benchmark guidance explicitly forbids changing antialiasing, DPR, layer visibility, weather/effect density, token visuals, or rules for better numbers. |
| Weather and field effects | Pass | Weather allocation changes reuse numeric buffers and skip inactive work without changing counts, opacity, colours, render order, materials, or motion semantics. `weatherVisualConfig` and `weatherVisualFactory` tests lock representative particle/material baselines. |
| Render scheduling | Pass | Dirty reasons and active animation sources wake frames for resize, camera, scene watchers, pointer interactions, texture loads, token/HUD style, targeting, layer visibility, and hidden-tab resume. Settled scenes stop duplicate idle RAF work only when no visible animation or dirty state remains. |
| Pointer interactions | Pass | Pointer travel and click semantics remain immediate; expensive hover, build/hazard preview, targeting, and movement-preview work is coalesced to the latest event per RAF and flushed before pointer-up/wheel actions. Focused tests cover coalescing, cache invalidation, and unchanged-anchor short-circuits. |
| Movement previews/pathfinding | Pass | Pathfinding caches are keyed by selected token, start/goal, dimensions, ground level, terrain revision, and placement revision. Cache tests cover hits, misses, invalidation, stale-state protection, and defensive cloning; movement path-line geometry reuse updates buffers without changing preview output. |
| Terrain, voxel, and token geometry | Pass | Shared geometry and semantic bucket diffing reuse resources only when output-relevant dimensions, material traits, and voxel positions are unchanged. Tests cover bucket signatures, overlay invalidation, token geometry ref-counting, resize, and disposal semantics. |
| CSS3D HUD and layer visibility | Pass | CSS3D dirty tracking skips CSS renderer work only on WebGL-only frames; HP bars, elevation badges, reticles, attack-of-opportunity buttons, and targeting overlays mark CSS dirty when output changes. Layer visibility applicators skip repeated identical writes but force application after renderer resource syncs. |
| Map and table functionality | Pass | The performance work did not remove terrain editing, hazards, field effects, movement previews, move targeting/automation, token controls, HP/status overlays, initiative, or sheet interactions. Existing and added Vitest coverage exercises map editor, move automation, interaction controllers, scheduler lifecycle, and cleanup paths. |

## Benchmark visual-equivalence check

The integrated benchmark pass records the same public fixture maps with normal renderer quality and visible effects enabled:

- Empty map: after initial settlement, the scene recorded `0` frames/renders over 30 seconds while terrain/grid remained visible with normal antialiasing and DPR settings.
- Typical campaign map: tokens, shadows, cages, HP/status overlays, hazards, rain, terrain/room effects, hover, and movement preview remained visible; continued frames came from intentional visible weather/effects.
- Stress map: dense terrain, 48 tokens, 40 hazards, weather particles/effects, overlays, and movement preview stayed enabled; no quality settings were lowered and no visuals/tools were hidden.

The benchmark pass also noted no app console errors or warnings beyond normal Nuxt dev informational logs.

## Follow-up guidance

- Treat any future output-changing optimization as a product change, not as map rendering performance-only work.
- Keep using the benchmark runbook and guardrail tests for later performance PRs.
- Use the [Map rendering performance readiness](performance-readiness.md) as the handoff checklist before accepting performance changes.
- Add focused tests or explicit docs whenever a new cache, dirty reason, or resource reuse path could affect visible output or tool behaviour.
