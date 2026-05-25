# Isometric render scheduler architecture

The isometric map uses dirty render scheduling to avoid duplicate idle frames while preserving the same visual output. A frame is scheduled only when scene state is dirty or when a concrete animation source still needs time to settle.

This page documents the Track 1 render-scheduler model for future map performance work. It complements the broader [Track 1 performance roadmap](track-1-performance-roadmap.md) and the no-quality-loss rules in [Performance guardrails](performance-guardrails.md).

## Key modules

| Area | File | Responsibility |
| --- | --- | --- |
| Vue/renderer bridge | `src/components/IsometricGrid.client.vue` | Owns the live Three.js/CSS3D scene, routes watcher/pointer/lifecycle events into the scheduler, and performs the one-shot render step. |
| Scheduler | `src/utils/isometric/renderScheduler.ts` | Coalesces dirty reasons, owns pending RAF state, continues while active animation is reported, and supports pause/resume/dispose. |
| Dirty reason model | `src/utils/isometric/renderInvalidation.ts` | Defines labelled `RenderInvalidationReason` values and merge/dedupe helpers used by scheduler and metrics. |
| Animation continuation model | `src/utils/isometric/renderLoop.ts` | Resolves which concrete animation sources should keep requesting frames after a one-shot render. |
| Scene watchers | `src/composables/isometric/useIsometricSceneWatchers.ts` | Syncs renderer objects after Vue state changes and requests focused render reasons. |
| Lifecycle helpers | `src/utils/isometric/lifecycle.ts` | Binds renderer DOM events, resize observation, visibility pause/resume, and resource cleanup. |
| Debug metrics | `src/utils/isometric/frameTimingSampler.ts`, `src/utils/isometric/renderMetrics.ts`, `src/components/isometric/RenderMetricsOverlay.vue` | Records scheduler frame timing/reasons and sampled WebGL renderer info only when render debug is explicitly enabled. |

## Dirty rendering flow

```text
Vue props, pointer events, async texture loads, resize/control/lifecycle events
  -> mutate or sync output-relevant renderer state
  -> requestScheduledSceneFrame(reason or reasons)
  -> createIsometricRenderScheduler coalesces dirty reasons into one pending RAF
  -> renderOneShotScheduledFrame updates animations, overlays, WebGL, CSS3D, and debug samples
  -> resolveSceneAnimationContinuation reports whether concrete animation sources need another frame
  -> scheduler either schedules the next active-animation frame or goes idle
```

Important behaviours:

- `requestRender` deduplicates reasons in first-seen order and never schedules more than one RAF while a frame is already pending.
- Dirty reasons are cleared at the start of the frame that consumes them. If an active animation was already running, the frame also includes the synthetic `animation` reason for metrics.
- A settled scene has no compatibility continuous loop. With no dirty reasons and no active animation, the scheduler intentionally stops requesting RAF callbacks.
- Hidden tabs call `pause()`, which cancels pending RAF work without clearing dirty reasons or active-animation state. When visible again, the scene calls `resume()` and requests `hidden-tab-resume` so the next visible frame is fresh.
- Unmount calls `dispose()`, then renderer resource cleanup. New invalidations after disposal are ignored by the disposed scheduler snapshot.

## Current invalidation reasons

`RenderInvalidationReason` values explain why a one-shot frame is needed. They are also the labels shown by the debug render metrics overlay.

| Reason | Use it when |
| --- | --- |
| `initial` | Mounting a new isometric scene. |
| `manual` | A direct render request has no more specific reason. Prefer a focused reason when one exists. |
| `resize` | Renderer bounds, DPR-dependent size, or grid dimensions require a size/frustum update. |
| `camera` | OrbitControls or camera state changes affect projected output. |
| `scene-state` | A broad scene-state fallback changes output but does not yet have a narrower reason. |
| `terrain` | Terrain voxel meshes or terrain-derived overlays change. |
| `hazards` | Persisted hazard meshes change. |
| `tokens` | Token render objects are created, deleted, moved, or updated. |
| `token-texture` | A current live-token or preview-token sprite texture load completes or fails. |
| `token-style` | Token selection, hover, HP/status HUD, combat-stage glass, active-turn styling, or layer-sensitive token styling changes. |
| `movement-preview` | Movement or send-out preview visuals/HUD state change. |
| `build-preview` | Build ghost or build-mode preview state changes. |
| `hazard-preview` | Hazard ghost or hazard-mode preview state changes. |
| `targeting` | Move targeting reticles, area templates, feedback overlays, or attack-of-opportunity UI positions change. |
| `field-effect` | Field-effect render meshes change. |
| `weather` | Weather/field-effect animation configuration changes. |
| `layer-visibility` | Resolved map layer visibility changes. |
| `pointer` | Pointer, wheel, context-menu, or escape interactions may have changed hover/preview/targeting state. |
| `animation` | Added by the scheduler on frames that are continuing because active animation was true. Do not request this manually for ordinary state changes. |
| `hidden-tab-resume` | The document became visible after a hidden-tab pause. |
| `debug` | Developer-only instrumentation needs a frame. |

## Active animation sources

Animation continuation sources answer a different question from dirty reasons: after rendering the current frame, should the scheduler keep producing frames?

| Source | Current responsibility |
| --- | --- |
| `token-motion` | Token center interpolation or selection lift has not settled. |
| `sprite-animation` | A visible, loaded token sprite has animation metadata that advances over time. |
| `sprite-texture-loading` | A visible token sprite texture is still loading/decoding and should keep the scene alive until the first visible texture frame can render. |
| `movement-preview-animation` | A visible movement/send-out preview ghost has animated sprite work or pending texture work. |
| `field-effect-animation` | Visible field-effect/weather renderers have active animators. |

Add an active source only for time-dependent work that must continue after the current frame. Do not use active animation as a substitute for a missing dirty reason; non-animated state changes should request a one-shot render instead.

## Adding a future invalidation reason

1. Prefer an existing reason if the new state change affects the same output layer. A new reason should make debugging or invalidation ownership clearer, not just add a metric name.
2. Add the string literal to `ISOMETRIC_RENDER_INVALIDATION_REASONS` and a human label to `ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS` in `src/utils/isometric/renderInvalidation.ts`.
3. Update focused tests in `tests/utils/isometric/renderInvalidation.test.ts`. The metrics reason list imports the invalidation constants, so this also guards debug-overlay alignment.
4. Request the reason at the mutation owner, after output-relevant renderer state is synced. Common sites are `useIsometricSceneWatchers`, pointer/interaction controllers via `requestScheduledSceneFrame`, async texture-load callbacks, resize/camera bindings, and document lifecycle handling.
5. Pass multiple reasons as an array when one state change affects several layers. The scheduler will dedupe them, so callers do not need to guard repeated requests in the same pending frame unless the sync work itself is expensive.
6. Keep the no-quality-loss contract intact: the reason should wake an equivalent render, not hide visuals, lower renderer quality, or skip required app behaviour.

## Adding a future animation continuation source

1. Expose a pure or easily testable state helper that answers whether the renderer still needs a future frame.
2. Add the source constant and type coverage in `src/utils/isometric/renderLoop.ts`.
3. Include the resolver in `resolveSceneAnimationContinuation()` in `IsometricGrid.client.vue`.
4. Add focused tests near the helper and in `tests/utils/isometric/renderLoop.test.ts` so idle/static states return no source and active states return the expected source.
5. Make sure the source becomes inactive when work settles; otherwise the scene will return to continuous RAF behaviour and lose the idle-performance benefit.

## Validation checklist

For render-scheduler changes, run the standard checks plus focused tests for the touched layer. At minimum, cover:

- dirty reasons merge and dedupe without mutation;
- no duplicate RAF scheduling while a frame is pending;
- active animation starts and stops as expected;
- hidden-tab pause/resume preserves dirty state;
- renderer quality, visual effects, token controls, previews, targeting, and HUD behaviour remain equivalent.
