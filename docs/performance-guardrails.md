# Performance guardrails

Rotom Table performance work must preserve the same visible map state and table functionality. Map rendering performance work optimizes duplicate work, scheduling, caching, and allocation patterns; it must not claim wins by degrading renderer quality or hiding features.

## Hard no-quality-loss rules

Do not use any of these as the primary optimization path:

- lowering renderer device pixel ratio, canvas resolution, or the existing high-DPI cap behaviour;
- disabling WebGL antialiasing;
- reducing weather or field-effect particle counts;
- removing weather, terrain, shadows, cages, HP bars, overlays, sprites, hazards, field effects, or token visuals;
- removing or simplifying token controls, move automation, targeting, build tools, hazard tools, or sheet interactions;
- adding a user-facing low-quality/performance mode that changes visual output;
- changing game rules to make rendering easier.

Acceptable performance changes should instead reduce avoidable work: dirty render scheduling, event coalescing, deterministic caches, safe resource reuse, skipped unchanged sync passes, and developer-only instrumentation.

## Reviewer checklist

For each performance PR, reviewers should confirm that:

- the same map data, camera, layers, and field effects produce equivalent visual output;
- renderer antialiasing remains enabled and device pixel ratio is not lowered below the established cap;
- weather and field-effect visuals keep their configured counts, colours, opacity, and motion semantics;
- map features remain reachable: terrain editing, hazards, field effects, movement previews, targeting, HP/status overlays, initiative, token controls, and sheet interactions;
- any new cache has explicit invalidation tests or a documented invalidation reason.

## Automated guardrails

Current tests include focused no-quality-loss checks:

- `tests/utils/isometric/rendererQuality.test.ts` verifies antialiasing and device-pixel-ratio behaviour.
- `tests/utils/isometric/weatherVisualConfig.test.ts` locks representative weather particle baselines.
- `tests/utils/isometric/weatherVisualFactory.test.ts` verifies every supported weather kind still creates a visible render group.

If a future product change intentionally alters visual output, document it separately and update these guardrails in the same reviewed change. Map rendering performance-only changes should not loosen them. The [Map rendering no-quality-loss audit](performance-no-quality-loss-audit.md) records the integrated map rendering performance review against these rules.
