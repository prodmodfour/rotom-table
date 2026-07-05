# Performance benchmark runbook

Use this runbook when collecting before/after map rendering performance measurements for the isometric map. The goal is to make performance changes observable while preserving the same map data, renderer quality, visual effects, and table functionality.

This workflow complements the scenario definitions in [Performance benchmark scenarios](performance-benchmark-scenarios.md), the public fixture generator in [Performance benchmark fixtures](performance-benchmark-fixtures.md), the recorded [Map rendering integrated benchmark pass](performance-benchmark-results.md), and the no-quality-loss rules in [Performance guardrails](performance-guardrails.md).

## 1. Choose the comparison

Decide which two commits or branches you are comparing before opening the app:

- **Before:** the base branch, merge base, or previous performance baseline that reviewers should compare against.
- **After:** the branch or commit under review.
- **Mode:** use the same app mode for both runs. The debug render overlay is dev-safe and normally appears in `npm run dev`; if you use a custom benchmark build, record that explicitly.
- **Fixture version:** use the same generated fixture maps for both runs. If the fixture generator changed, record the generator commit and rerun both before and after with the refreshed fixtures.

Do not change antialiasing, device pixel ratio, weather/effect density, layer visibility, token visuals, or map rules to improve the result. If a metric is unavailable, record `N/A` rather than changing the scenario.

## 2. Prepare the benchmark environment

1. Install dependencies if needed:

   ```bash
   npm install
   ```

2. Generate deterministic local maps from public example data:

   ```bash
   node scripts/generate_benchmark_maps.mjs --overwrite
   ```

   Generated files live under `data/maps/performance-benchmarks/` and are ignored local data. Do not commit them.

3. Start the app in the same mode for both runs:

   ```bash
   npm run dev
   ```

4. Open the empty, typical, and stress fixture maps. On each map route, append one of the render debug flags:

   ```text
   ?debug=render
   ?debug=render-metrics
   ?debug=isometric-render
   ```

5. Keep these inputs stable for every run:

   - hardware, operating system, browser version, browser zoom, power mode, and external displays;
   - browser devtools state, app mode, viewport size, and device pixel ratio;
   - map fixture, camera angle, zoom level, selected tool, selected token, layer visibility, weather, field effects, and overlays;
   - measurement window length and pointer/camera movement script.

Run one warm-up load first and discard it if the browser is still compiling, loading textures, or warming caches.

## 3. Measurement protocol

For each scenario and branch:

1. Reload the map route with the debug query flag.
2. Restore the same camera, zoom, layer visibility, selected tool, and selected token.
3. Wait until obvious one-time work settles: initial texture loads, token lerps, camera movement, and any intentional setup interactions.
4. Record the overlay values at the start of the window.
5. Perform the benchmark window:
   - **Idle:** do not move the pointer or camera for 30 seconds.
   - **Camera/control:** repeat the same pan/orbit/zoom path when testing camera or scheduler work.
   - **Pointer sweep:** move over the same terrain, tokens, build targets, hazards, and movement-preview anchors for the same duration.
   - **Movement preview:** select the same token and revisit the same target anchors before testing different terrain/elevation targets.
6. Record the overlay values at the end of the window and compute deltas from the start values.
7. Note visible behaviour: hover latency, preview freshness, HUD alignment, texture loads, weather/effect motion, console errors, and any jank.

The overlay counters are cumulative for the current map mount. Prefer start/end deltas over a single absolute number. Repeat noisy measurements three times and report the median or the range.

## 4. Metrics to capture

| Category | Capture | Why it matters |
| --- | --- | --- |
| Run identity | Date, branch/commit, browser, hardware notes, app mode, scenario, and before/after label. | Makes numbers reproducible and reviewable. |
| Scene invariants | Fixture name, map dimensions, token count, hazards/effects/weather, camera/zoom, selected token/tool, layer state, and viewport size. | Confirms both branches measured the same scene. |
| Idle frame work | `Frames`, `Renders`, `Animated frames`, `Active animation`, average/max/last frame duration, and frame reason deltas. | Shows whether settled scenes stop duplicate RAF/render work. |
| Renderer counters | Draw calls, triangles, lines, points, renderer frame, geometries, textures, programs, and auto-reset state. | Tracks WebGL workload and resource counts for the same visible scene. |
| Move VFX | Active VFX, instance groups, `Keeps scheduler active`, root visibility, layer visibility, and disposed state when testing move animations. | Shows whether transient move VFX are intentionally responsible for continued animation frames and whether they settle back to idle. |
| Pointer work | Pointermove events, processed pointer frames, coalesced move events, last pointer frame events, total raycasts, and raycasts by kind. | Verifies pointer-heavy work is coalesced and cached. |
| Pathfinding work | Pathfinding requests, path cache hits, and path cache misses for repeated movement-preview anchors. | Verifies duplicate movement previews reuse cached path results. |
| Visual equivalence | Antialiasing, DPR, sprites, contact shadows, tactical cage affordances, HP/status overlays, elevation badges, terrain, hazards, weather/effects, targeting, and tools. | Ensures performance wins did not come from degraded output or removed behaviour. |
| Resource stability | Geometries/textures/programs after repeated interactions and after leaving/reopening the map if tested. | Catches leaks or stale renderer resources. |

## 5. Interpreting the debug overlay

### Sample

`Sample` is the timestamp of the latest debug snapshot. If renderer info says `pending`, wait for the next scheduled render or perform a harmless camera/pointer interaction that should request a frame.

### Frames

- **Frames** counts scheduler samples since the map mounted.
- **Renders** counts samples that performed a renderer call.
- **Animated frames** counts frames where the scheduler believed active visual work still needed continuation.
- **Active animation** reports whether the latest sampled frame still had an active continuation source.
- **Average/Max/Last frame** are browser timing samples. Use them as rough relative numbers, especially in dev mode.

Expected idle result: on a static scene with no visible animated sprites, loading textures, token motion, movement-preview ghost animation, or weather/field-effect animation, `Frames` and `Renders` should stop increasing after the scene settles. If weather, field effects, animated sprites, or texture loading are visible, continued animated frames can be valid; compare the same visible effects before and after.

### Reasons

The **Reasons** section shows why frames were requested. `Last` lists the most recent frame reasons, and the rows show cumulative reason counts.

Useful signals:

- repeated `animation` reasons imply active continuation work;
- repeated `pointer`, `movement-preview`, `build-preview`, `hazard-preview`, or `targeting` during a pointer sweep are expected, but should not continue while idle;
- repeated `resize` or `camera` while nothing is changing can indicate redundant DOM bounds, size, or controls work;
- broad `scene-state` reasons should be rare when a more focused reason exists.

### Move VFX

The **Move VFX** section appears when the map route uses the render-debug flag. It samples the move VFX renderer only through the dev overlay path:

- **Active VFX** is the number of transient VFX lifecycle instances currently owned by the renderer.
- **Instance groups** is the number of root child groups under `move-vfx-root`; it should normally match Active VFX and return to `0` after effects complete.
- **Keeps scheduler active** reports whether move VFX currently contributes the `move-vfx-animation` continuation source.
- **Root visible** and **Layer visible** distinguish an active hidden-layer effect from a visible effect.

Expected idle result: after move VFX complete or are cleared, Active VFX and Instance groups should be `0`, and Keeps scheduler active should be `no`. If frame reasons continue to show `animation`, check visible weather, field effects, animated sprites, token motion, movement previews, texture loading, and the move VFX rows to identify the active source.

### Renderer

Renderer rows mirror sampled Three.js `renderer.info` values:

- **Draw calls, triangles, lines, points** describe the latest rendered WebGL workload when `auto reset` is enabled.
- **Geometries, textures, programs** describe current renderer resource counts.
- **Renderer frame** is the renderer's own frame counter and is mainly useful as a sanity check that samples are advancing.

For the same camera, layers, and scene state, lower or stable draw/resource counts are useful. A performance change must not lower these by hiding visuals, reducing particle counts, lowering DPR, or disabling antialiasing. Resource counts that grow after repeating the same interaction may indicate a leak.

### Pointer

Pointer rows are cumulative since mount:

- **Pointermove events** is the raw input count seen by the map.
- **Processed pointer frames** is how many coalesced pointer RAF callbacks ran.
- **Coalesced move events** is the number of raw move events absorbed into processed frames.
- **Last pointer frame events** shows how many raw events were represented by the latest processed pointer frame.
- **Raycasts** and the raycast-kind rows show picking work for token, movement-plane, build, and hazard targets.

During a fast pointer sweep, processed pointer frames should be less than or equal to raw pointermove events. During idle, pointer and raycast deltas should stay at zero.

### Pathfinding cache

- **Pathfinding requests** counts movement-preview pathfinding attempts.
- **Path cache hits** counts preview anchors served from cache.
- **Path cache misses** counts preview anchors that needed a fresh computation.

For repeated movement-preview anchors with unchanged terrain, placement, dimensions, ground level, and selected token, hit deltas should rise after the first visit. Misses are expected for new anchors or after terrain/placement/selection changes.

## 6. Delta formulas

Use start/end overlay values for the same measurement window:

```text
idle render delta = Renders_end - Renders_start
processed pointer frame delta = ProcessedPointerFrames_end - ProcessedPointerFrames_start
coalescing ratio = ProcessedPointerFrameDelta / PointermoveEventDelta
path cache hit rate = PathCacheHitsDelta / (PathCacheHitsDelta + PathCacheMissesDelta)
```

If a denominator is zero because that interaction was not exercised, record `N/A`.

## 7. Reporting template

Copy this into PR notes or benchmark docs when data is available:

| Scenario | Branch/commit | Window | Frame/render delta | Renderer counters | Pointer/path deltas | Visual-equivalence notes |
| --- | --- | --- | --- | --- | --- | --- |
| Empty map | before: / after: | 30s idle |  |  |  |  |
| Typical campaign map | before: / after: | idle + pointer + movement preview |  |  |  |  |
| Stress map | before: / after: | idle + pointer + movement preview |  |  |  |  |

Also record any caveats: dev server mode, browser throttling, visible animated weather/effects, unavailable overlay values, console errors, or measurements that were not exercised.

## 8. Troubleshooting

- **Overlay does not appear:** confirm the map route has one of the supported query flags and that the app is running in development mode or an explicitly allowed benchmark/debug build.
- **Renderer info remains pending:** wait for a render-triggering event, reload the map, or perform a small camera/pointer action that should request a frame.
- **Idle frames keep increasing:** check for visible weather, field effects, animated sprites, movement preview ghosts, pending sprite texture loads, token motion, or a repeated dirty reason.
- **Numbers change after switching branches:** restart the dev server and reload the same generated fixtures so HMR state does not carry across runs.
- **Generated maps appear in git status:** leave them untracked/ignored local data and do not commit private or generated benchmark map JSON.
