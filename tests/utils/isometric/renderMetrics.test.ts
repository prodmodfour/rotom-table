import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC_RENDER_FRAME_REASON_LABELS,
  ISOMETRIC_RENDER_FRAME_REASONS,
  createEmptyIsometricRenderMetricsSnapshot,
  createEmptyRenderFrameTimingMetrics,
  createEmptySampledWebGLRendererInfo,
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
      lastFrameReasons: [],
      reasonCounts: {},
    })
    expect(metrics.lastFrameReasons).not.toBe(nextMetrics.lastFrameReasons)
    expect(metrics.reasonCounts).not.toBe(nextMetrics.reasonCounts)
  })

  it('creates a sampled WebGL renderer info shell for future renderer.info collection', () => {
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
    expect(snapshot.frames.frameCount).toBe(0)
    expect(snapshot.frames.lastFrameReasons).toEqual([])
  })
})
