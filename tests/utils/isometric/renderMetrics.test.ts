import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC_RENDER_FRAME_REASON_LABELS,
  ISOMETRIC_RENDER_FRAME_REASONS,
  createEmptyIsometricRenderMetricsSnapshot,
  createEmptyPointerInteractionMetrics,
  createEmptyRenderFrameTimingMetrics,
  createEmptySampledWebGLRendererInfo,
  createIsometricRenderMetricsSnapshotWithFrameTiming,
  createIsometricRenderMetricsSnapshotWithMoveVfx,
  createIsometricRenderMetricsSnapshotWithPointerInteractions,
  createIsometricRenderMetricsSnapshotWithRendererInfo,
  createRenderFrameReasonCounts,
  incrementRenderFrameReasonCount,
  isRenderFrameReason,
} from '~/utils/isometric/renderMetrics'

describe('isometric render metrics model', () => {
  it('defines labelled frame reasons for developer-only render instrumentation', () => {
    expect(new Set(ISOMETRIC_RENDER_FRAME_REASONS).size).toBe(ISOMETRIC_RENDER_FRAME_REASONS.length)
    expect(Object.keys(ISOMETRIC_RENDER_FRAME_REASON_LABELS).sort()).toEqual(
      [...ISOMETRIC_RENDER_FRAME_REASONS].sort(),
    )
    expect(ISOMETRIC_RENDER_FRAME_REASON_LABELS.animation).toContain('animation')
    expect(ISOMETRIC_RENDER_FRAME_REASON_LABELS['token-texture']).toContain('texture')
  })

  it('narrows unknown values to known frame reasons', () => {
    expect(isRenderFrameReason('resize')).toBe(true)
    expect(isRenderFrameReason('weather')).toBe(true)
    expect(isRenderFrameReason('controller-build-note')).toBe(false)
    expect(isRenderFrameReason(null)).toBe(false)
  })

  it('creates immutable-style frame reason count updates', () => {
    const counts = createRenderFrameReasonCounts([
      'resize',
      'resize',
      'animation',
      'token-style',
    ])
    const updated = incrementRenderFrameReasonCount(counts, 'resize')

    expect(counts).toEqual({
      resize: 2,
      animation: 1,
      'token-style': 1,
    })
    expect(updated).toEqual({
      resize: 3,
      animation: 1,
      'token-style': 1,
    })
  })

  it('creates zeroed frame timing metrics without sampling browser state', () => {
    const metrics = createEmptyRenderFrameTimingMetrics()
    const nextMetrics = createEmptyRenderFrameTimingMetrics()

    expect(metrics).toEqual({
      frameCount: 0,
      renderCount: 0,
      activeAnimationFrameCount: 0,
      totalFrameDurationMs: 0,
      averageFrameDurationMs: null,
      maxFrameDurationMs: 0,
      lastFrameDurationMs: null,
      lastFrameHadActiveAnimation: false,
      lastFrameReasons: [],
      reasonCounts: {},
    })
    expect(metrics.lastFrameReasons).not.toBe(nextMetrics.lastFrameReasons)
    expect(metrics.reasonCounts).not.toBe(nextMetrics.reasonCounts)
  })

  it('creates zeroed pointer interaction metrics without sampling browser state', () => {
    const metrics = createEmptyPointerInteractionMetrics()
    const nextMetrics = createEmptyPointerInteractionMetrics()

    expect(metrics).toEqual({
      pointerMoveEventCount: 0,
      pointerMoveFrameCount: 0,
      coalescedPointerMoveEventCount: 0,
      lastPointerMoveFrameCoalescedEventCount: null,
      raycastCount: 0,
      raycastCounts: {},
      pathfindingRequestCount: 0,
      pathfindingCacheHitCount: 0,
      pathfindingCacheMissCount: 0,
    })
    expect(metrics.raycastCounts).not.toBe(nextMetrics.raycastCounts)
  })

  it('creates a sampled WebGL renderer info shell', () => {
    const sample = createEmptySampledWebGLRendererInfo(1234)
    const nextSample = createEmptySampledWebGLRendererInfo(5678)

    expect(sample).toEqual({
      sampledAtMs: 1234,
      autoReset: null,
      memory: {
        geometries: 0,
        textures: 0,
      },
      render: {
        calls: 0,
        frame: 0,
        lines: 0,
        points: 0,
        triangles: 0,
      },
      programs: {
        count: null,
      },
    })
    expect(sample.memory).not.toBe(nextSample.memory)
    expect(sample.render).not.toBe(nextSample.render)
    expect(sample.programs).not.toBe(nextSample.programs)
  })

  it('creates a dev-only metrics snapshot without wiring overlay state', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(42)

    expect(snapshot.devOnly).toBe(true)
    expect(snapshot.sampledAtMs).toBe(42)
    expect(snapshot.rendererInfo).toBeNull()
    expect(snapshot.moveVfx).toBeNull()
    expect(snapshot.frames.frameCount).toBe(0)
    expect(snapshot.frames.lastFrameReasons).toEqual([])
    expect(snapshot.pointerInteractions.pointerMoveEventCount).toBe(0)
    expect(snapshot.pointerInteractions.raycastCounts).toEqual({})
  })

  it('adds frame timing metrics to an existing metrics snapshot without mutating it', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(42)
    const frames = createEmptyRenderFrameTimingMetrics()
    frames.frameCount = 3
    frames.renderCount = 3
    frames.activeAnimationFrameCount = 2
    frames.lastFrameHadActiveAnimation = true
    frames.lastFrameReasons.push('initial', 'animation')
    frames.reasonCounts.initial = 1
    frames.reasonCounts.animation = 3

    const updated = createIsometricRenderMetricsSnapshotWithFrameTiming(snapshot, frames, 128)

    expect(snapshot.frames.frameCount).toBe(0)
    expect(updated).not.toBe(snapshot)
    expect(updated.devOnly).toBe(true)
    expect(updated.sampledAtMs).toBe(128)
    expect(updated.rendererInfo).toBeNull()
    expect(updated.frames).toEqual(frames)
    expect(updated.frames).not.toBe(frames)
    expect(updated.frames.lastFrameReasons).not.toBe(frames.lastFrameReasons)
    expect(updated.frames.reasonCounts).not.toBe(frames.reasonCounts)
  })

  it('adds sampled renderer info to an existing metrics snapshot without mutating it', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(42)
    const rendererInfo = createEmptySampledWebGLRendererInfo(250)
    rendererInfo.memory.geometries = 4
    rendererInfo.render.calls = 12
    rendererInfo.programs.count = 3

    const updated = createIsometricRenderMetricsSnapshotWithRendererInfo(snapshot, rendererInfo)

    expect(snapshot.rendererInfo).toBeNull()
    expect(updated).not.toBe(snapshot)
    expect(updated.devOnly).toBe(true)
    expect(updated.frames).toBe(snapshot.frames)
    expect(updated.sampledAtMs).toBe(250)
    expect(updated.rendererInfo).toEqual(rendererInfo)
    expect(updated.rendererInfo).not.toBe(rendererInfo)
    expect(updated.rendererInfo?.memory).not.toBe(rendererInfo.memory)
    expect(createIsometricRenderMetricsSnapshotWithRendererInfo(snapshot, null)).toBe(snapshot)
  })

  it('adds move VFX metrics to an existing metrics snapshot without mutating it', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(42)
    const moveVfx = {
      activeCount: 2,
      instanceGroupCount: 2,
      needsAnimationFrame: true,
      visible: true,
      css3DActive: false,
      layerVisible: true,
      disposed: false,
    }

    const updated = createIsometricRenderMetricsSnapshotWithMoveVfx(snapshot, moveVfx, 512)

    expect(snapshot.moveVfx).toBeNull()
    expect(updated).not.toBe(snapshot)
    expect(updated.devOnly).toBe(true)
    expect(updated.sampledAtMs).toBe(512)
    expect(updated.frames).toBe(snapshot.frames)
    expect(updated.rendererInfo).toBeNull()
    expect(updated.pointerInteractions).toBe(snapshot.pointerInteractions)
    expect(updated.moveVfx).toEqual(moveVfx)
    expect(updated.moveVfx).not.toBe(moveVfx)
    expect(createIsometricRenderMetricsSnapshotWithMoveVfx(updated, null).moveVfx).toBeNull()
  })

  it('adds pointer interaction metrics to an existing metrics snapshot without mutating it', () => {
    const snapshot = createEmptyIsometricRenderMetricsSnapshot(42)
    const pointerInteractions = createEmptyPointerInteractionMetrics()
    pointerInteractions.pointerMoveEventCount = 5
    pointerInteractions.pointerMoveFrameCount = 2
    pointerInteractions.coalescedPointerMoveEventCount = 5
    pointerInteractions.lastPointerMoveFrameCoalescedEventCount = 3
    pointerInteractions.raycastCount = 4
    pointerInteractions.raycastCounts['token-pick'] = 3
    pointerInteractions.pathfindingRequestCount = 1
    pointerInteractions.pathfindingCacheHitCount = 2
    pointerInteractions.pathfindingCacheMissCount = 1

    const updated = createIsometricRenderMetricsSnapshotWithPointerInteractions(
      snapshot,
      pointerInteractions,
      300,
    )

    expect(snapshot.pointerInteractions.pointerMoveEventCount).toBe(0)
    expect(updated).not.toBe(snapshot)
    expect(updated.devOnly).toBe(true)
    expect(updated.sampledAtMs).toBe(300)
    expect(updated.frames).toBe(snapshot.frames)
    expect(updated.rendererInfo).toBeNull()
    expect(updated.pointerInteractions).toEqual(pointerInteractions)
    expect(updated.pointerInteractions).not.toBe(pointerInteractions)
    expect(updated.pointerInteractions.raycastCounts).not.toBe(pointerInteractions.raycastCounts)
  })
})
