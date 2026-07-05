# Map rendering integrated benchmark pass

This page records an integrated benchmark pass using the public performance fixture maps and the debug render overlay. It is a current implementation measurement, not a historical baseline checkout: the pre-instrumentation state did not have equivalent overlay counters. In the tables below, **before** means the overlay snapshot at the start of a measurement window and **after** means the end-of-window overlay delta.

## Run identity

| Field | Value |
| --- | --- |
| Date | 2026-05-25 07:51 UTC |
| Measurement source | Current map-rendering performance implementation |
| App mode | `npm run dev`, Nuxt dev server at `http://127.0.0.1:3100` |
| Browser | Headless Chrome 147 on Linux x86_64 |
| Viewport | `1280×720`, browser/device pixel ratio `1` |
| Fixture command | `node scripts/generate_benchmark_maps.mjs --overwrite` |
| Debug flag | `?debug=render` |
| Measurement windows | 30s idle after an 8s warm-up; scripted pointer sweep; six repeated movement-preview anchors for typical/stress maps |

The fixture generator was refreshed before the pass so the browser-observed token counts match the documented fixture counts. Generated files under `data/maps/performance-benchmarks/` remain ignored local data and are not committed.

## Scenario results

| Scenario | Scene invariants | Idle before → after | Renderer counters after idle | Pointer/path window | Visual-equivalence notes |
| --- | --- | --- | --- | --- | --- |
| Empty map | `8×3×8`, 64 voxels, 0 tokens, 0 hazards/effects | Start: 1 rendered frame, active animation `no`; 30s delta: `0` frames / `0` renders / `0` pointer or raycast work | 10 draw calls, 770 triangles, 50 lines, 5 geometries, 4 textures, 3 programs | Not exercised; no tokens/path targets | Static scene stopped rendering after initial settlement. Terrain/grid remained visible with normal antialiasing/DPR settings. |
| Typical campaign map | `18×5×14`, 285 voxels, 8 tokens, 6 hazards, 1 weather, 1 terrain, 1 room | Start: active animation `yes`; 30s delta: 211 frames / 211 renders, all `animation` reason from visible weather/effects | 144 draw calls, 4,934 triangles, 568 lines, 35 geometries, 40 textures, 11 programs | Pointer sweep: 167 pointermove events, 167 processed frames, 167 raycasts. Movement preview (`typical-token-01`, 6 anchors): 3 pathfinding requests, 3 cache misses, 2 cache hits; consecutive unchanged anchor short-circuited before cache work. | Rain/terrain/room effects, sprites, contact shadows, tactical cage affordances for hover/selection states, HP/status overlays, hazards, grid, hover, and movement preview remained visible. Continued idle rendering is expected because the fixture intentionally has animated weather. |
| Stress map | `32×8×28`, 1,081 voxels, 48 tokens, 40 hazards, 2 weather, 4 terrain, 3 rooms | Start: active animation `yes`; 30s delta: 45 frames / 45 renders, all `animation` reason from visible weather/effects | 692 draw calls, 30,378 triangles, 991 lines, 195 points, 131 geometries, 71 textures, 13 programs | Pointer sweep: 167 pointermove events, 167 processed frames, 167 raycasts. Movement preview (`stress-token-01`, 6 anchors): 3 pathfinding requests, 3 cache misses, 2 cache hits; consecutive unchanged anchor short-circuited before cache work. | Dense terrain, tokens, hazards, weather particles/effects, overlays, and movement preview stayed enabled. No quality settings were lowered and no visuals/tools were hidden for the measurement. |

## Move VFX performance review (VFX-082)

A move-animation-specific pass was recorded after the generic VFX integration to check dependency, bundle, scheduler, and renderer-resource behaviour.

| Field | Value |
| --- | --- |
| Date | 2026-05-31 UTC |
| Measurement source | move VFX feature branch during VFX-082 review |
| App mode | `npm run dev`, Nuxt dev server at `http://127.0.0.1:3100` |
| Browser | Headless Chrome via Playwright on Linux x86_64 |
| Debug flags | `?debug=render,move-vfx` |
| Fixture command | `node scripts/generate_benchmark_maps.mjs --overwrite`; plus an ignored local static VFX fixture derived from `benchmark-typical-map` with hazards/field effects removed |
| Stress action | Select a controllable token in the dev-only VFX harness and trigger **Play all primitives** once on the static fixture, then five rapid times on the stress fixture |

Dependency and asset review: `package.json` / `package-lock.json` were unchanged by the move VFX branch, no animation library was added, and no external VFX asset packs or generated build output are committed. The production build still uses the existing Three.js dependency plus local TypeScript helpers/primitives.

| Scenario | Window | Move VFX metrics | Renderer counters | Scheduler / quality notes |
| --- | --- | --- | --- | --- |
| Static VFX fixture | Before preview | `Active VFX 0`, `Instance groups 0`, `Keeps scheduler active no` | 129 draw calls, 3,902 triangles, 691 lines, 27 geometries, 35 textures, 8 programs | The selected example sprite kept the overall scheduler in an active sprite-animation state, but move VFX itself was idle and invisible. |
| Static VFX fixture | During one **Play all primitives** pass | `Active VFX 15`, `Instance groups 15`, `Keeps scheduler active yes`, `CSS3D badge active yes` | 141 draw calls, 5,582 triangles, 691 lines, 33 geometries, 35 textures, 9 programs | The temporary increase came from active WebGL primitives plus the optional badge. No renderer quality setting or map feature was disabled. |
| Static VFX fixture | After settle plus idle wait | `Active VFX 0`, `Instance groups 0`, `Keeps scheduler active no`, `CSS3D badge active no` | Returned to 129 draw calls, 3,902 triangles, 691 lines, 27 geometries, 35 textures, 8 programs | The map bridge pruned the expired runtime queue when the renderer transitioned from active to settled, so the dev harness count also returned to zero without adding a timer or separate RAF loop. |
| Stress map | Before repeated previews | `Active VFX 0`, `Instance groups 0`, `Keeps scheduler active no` | 693 draw calls, 30,378 triangles, 2,444 lines, 195 points, 132 geometries, 71 textures, 13 programs | Existing weather/field effects and sprites intentionally kept overall animation active; move VFX was not a continuation source while idle. |
| Stress map | During five rapid **Play all primitives** passes | `Active VFX 10`, `Instance groups 10`, `Keeps scheduler active yes`, `CSS3D badge active yes` | 715 draw calls, 31,222 triangles, 2,444 lines, 195 points, 143 geometries, 71 textures, 14 programs | Repeated previews produced bounded active counts under the existing scheduler. |
| Stress map | After settle plus idle wait | `Active VFX 0`, `Instance groups 0`, `Keeps scheduler active no`, `CSS3D badge active no` | Returned to 693 draw calls, 30,378 triangles, 2,444 lines, 195 points, 132 geometries, 71 textures, 13 programs | No growing VFX instance groups, geometries, textures, or programs were observed after effects completed. Browser console reported 0 errors and 0 warnings beyond normal Nuxt dev info. |

The review found one cleanup polish item: completed events could remain in the runtime queue until the next enqueue, which made the dev-only harness display a stale active count even though the renderer had disposed its instances. The grid now emits a `move-vfx-settled` signal when `MoveVfxRenderer.needsAnimationFrame()` transitions from true to false, and the map page uses the renderer-clock timestamp to prune expired queue entries. This keeps idle renderer input aligned with the debug metrics without persistence, timers, degraded quality settings, or another animation loop.

## Notes and caveats

- The move VFX static fixture still showed overall `Active animation yes` because the selected example token sprite remained an independent sprite-animation source. The VFX-specific rows are the source of truth for whether move VFX keeps the scheduler alive.
- The pointer sweep was generated by Playwright with ~12 ms between move steps, so processed pointer frames matched raw move events. Faster real pointer input should show lower processed-frame deltas because the pointer coalescer only processes the latest event once per animation frame.
- Typical and stress idle windows intentionally kept rendering because animated weather/field effects were visible. The empty map confirms the settled no-animation path stops duplicate idle RAF/render work.
- Movement-preview cache notes use repeated anchors on the same selected token. Hits appear after the first visit to an unchanged terrain/placement key; immediately repeated identical anchors are short-circuited earlier and do not increment cache counters.
- Browser console after the recorded pass had no app errors or warnings beyond normal Nuxt dev informational logs.
- The [Map rendering no-quality-loss guardrails](performance-no-quality-loss.md) records the visual-quality and functionality review for this benchmark pass, and the [Map rendering performance readiness](performance-readiness.md) records readiness for repository review.
