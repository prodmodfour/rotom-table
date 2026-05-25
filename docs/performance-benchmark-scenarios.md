# Performance benchmark scenarios

Track 1 performance PRs should compare the same scenario before and after the change. These scenarios define the map categories to exercise; they intentionally avoid private campaign data and do not require lowering visual quality, disabling effects, or changing rules to produce better numbers.

Use `?debug=render`, `?debug=render-metrics`, or `?debug=isometric-render` on map routes when collecting debug overlay values. If a metric is not available yet, record `N/A` rather than changing the scenario.

## Shared recording rules

For every before/after PR measurement, keep these inputs stable:

- hardware class, operating system, browser, browser zoom, and power mode;
- branch or commit, app build mode, and whether dev tools are open;
- map data, camera angle, zoom level, viewport size, and device pixel ratio;
- layer visibility, weather, field effects, token visibility, HP/status overlays, and selected tool;
- timing window, such as 30 seconds idle after the scene settles or one repeated pointer sweep.

Record at least the following fields for each scenario:

| Field | What to capture |
| --- | --- |
| Run identity | Date, branch/commit, browser, hardware notes, scenario name, and whether this is before or after the PR. |
| Scene invariants | Map dimensions, approximate token count, visible weather/effects, visible overlays, camera/zoom, and layer state. |
| Idle render work | Render count delta over the idle window, active-animation state, average/max frame duration when available, and whether duplicate idle frames continue. |
| Renderer counters | WebGL `renderer.info` values from the debug overlay, especially render calls, triangles, points/lines, geometries, textures, and programs when exposed. |
| Interaction work | Pointermove/raycast/pathfinding counts, movement-preview recalculations, and cache hit/miss counters when those overlay metrics are available. |
| Visual equivalence | Notes that antialiasing, device pixel ratio, weather particles, effects, shadows, cages, sprites, HP bars, overlays, and tool behaviour remain unchanged. |
| User-visible issues | Jank, delayed hover/preview updates, missing texture loads, stale overlays, console errors, or memory/resource growth after repeated interactions. |

## Scenario 1: Empty map

Purpose: isolate baseline renderer overhead, resize/camera work, and idle scheduling with almost no scene complexity.

Representative contents:

- a new or minimal map with default terrain and no private campaign content;
- zero or one token, no hazards, and no intentional stress effects;
- default layer visibility and normal renderer quality settings;
- a stable camera/zoom position that can be restored for before/after runs.

Before/after measurements to record:

- idle render count delta for the same settled window;
- frame timing and active-animation state when available;
- WebGL calls, triangles, geometries, textures, and programs;
- resize or camera-control observations if the PR touches scheduler or size logic;
- a visual-equivalence note confirming the empty scene still uses the same antialiasing, device pixel ratio, terrain appearance, and controls.

## Scenario 2: Typical campaign map

Purpose: measure the common GM/player session where terrain, tokens, overlays, and tactical tools are all present but not intentionally pathological.

Representative contents:

- medium terrain with several elevations or voxel features;
- several trainer/Pokémon tokens using normal sprites, shadows, cages, HP bars, status/condition indicators, and elevation badges where appropriate;
- at least one visible hazard or field effect, plus weather when a tested PR could affect weather or active animation;
- normal layer visibility and at least one selected token for movement preview testing;
- no real campaign names, notes, secrets, or private images.

Before/after measurements to record:

- idle render count and frame timing after the map settles;
- renderer calls/triangles/geometries/textures while all typical overlays are visible;
- a short camera pan/orbit or zoom observation when the PR touches controls or render invalidation;
- hover/selection responsiveness across multiple tokens;
- movement preview work for the same selected token and repeated target anchors, including pathfinding and cache metrics when available;
- visual-equivalence notes for sprites, shadows, cages, HP/status overlays, hazards, weather/effects, and map tools.

## Scenario 3: Stress map

Purpose: keep worst-case editor and combat interactions measurable so optimizations do not only help empty or average scenes.

Representative contents:

- large or dense terrain with many visible voxels/elevations;
- many visible tokens with varied dimensions, sprites, shadows, HP/status overlays, and elevation badges;
- multiple hazards, field effects, weather, and layer combinations that remain visually meaningful;
- build/hazard preview targets available across different elevations;
- a selected token whose movement preview crosses complex terrain and occupied spaces.

Before/after measurements to record:

- initial settled idle render count, frame timing, and active-animation state;
- renderer calls, triangles, points/lines, geometries, textures, and programs;
- pointer-heavy sweeps over terrain, tokens, hazards, and build targets;
- repeated movement-preview target changes across the same route and across different elevations;
- pathfinding, pointer, raycast, and cache metrics when available;
- visible jank, delayed previews, stale HUD/CSS3D overlays, missing texture updates, or resource growth after repeated interactions;
- visual-equivalence notes confirming particle counts, opacity, colours, motion semantics, sprites, overlays, controls, and rule behaviour were not reduced.

## PR note template

Use this compact table in performance PR notes when benchmark data is available:

| Scenario | Before branch/commit | After branch/commit | Idle render delta | Renderer counters | Interaction counters | Visual-equivalence notes |
| --- | --- | --- | --- | --- | --- | --- |
| Empty map |  |  |  |  |  |  |
| Typical campaign map |  |  |  |  |  |  |
| Stress map |  |  |  |  |  |  |

When a PR only affects one subsystem, still list the unaffected scenarios as `Not exercised` or `N/A` with a short reason. Do not alter scenario quality settings to make a result look better.
