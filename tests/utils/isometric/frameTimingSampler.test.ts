import { describe, expect, it } from 'vitest'
import { createRenderFrameTimingSampler } from '~/utils/isometric/frameTimingSampler'
import type { RenderFrameTimingMetrics } from '~/utils/isometric/renderMetrics'

const expectEmptyTimingMetrics = (metrics: RenderFrameTimingMetrics) => {
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
}

describe('render frame timing sampler', () => {
  it('aggregates frame duration, render count, active animation state, and reasons', () => {
    const sampler = createRenderFrameTimingSampler()

    const first = sampler.recordFrame({
      durationMs: 16,
      activeAnimation: true,
      reasons: ['initial', 'animation'],
    })

    expect(first).toEqual({
      frameCount: 1,
      renderCount: 1,
      activeAnimationFrameCount: 1,
      totalFrameDurationMs: 16,
      averageFrameDurationMs: 16,
      maxFrameDurationMs: 16,
      lastFrameDurationMs: 16,
      lastFrameHadActiveAnimation: true,
      lastFrameReasons: ['initial', 'animation'],
      reasonCounts: {
        initial: 1,
        animation: 1,
      },
    })

    const second = sampler.recordFrame({
      durationMs: 20,
      rendered: false,
      activeAnimation: false,
      reasons: ['pointer', 'pointer'],
    })

    expect(second.frameCount).toBe(2)
    expect(second.renderCount).toBe(1)
    expect(second.activeAnimationFrameCount).toBe(1)
    expect(second.totalFrameDurationMs).toBe(36)
    expect(second.averageFrameDurationMs).toBe(18)
    expect(second.maxFrameDurationMs).toBe(20)
    expect(second.lastFrameDurationMs).toBe(20)
    expect(second.lastFrameHadActiveAnimation).toBe(false)
    expect(second.lastFrameReasons).toEqual(['pointer', 'pointer'])
    expect(second.reasonCounts).toEqual({
      initial: 1,
      animation: 1,
      pointer: 2,
    })
  })

  it('uses browser-safe clock injection for started frame samples', () => {
    const nowSamples = [116, Number.NaN]
    const sampler = createRenderFrameTimingSampler({ now: () => nowSamples.shift() ?? 0 })

    expect(sampler.recordFrame({ startedAtMs: 100 }).lastFrameDurationMs).toBe(16)
    expect(sampler.recordFrame({ startedAtMs: 200 }).lastFrameDurationMs).toBe(0)
    expect(sampler.recordFrame({ startedAtMs: 50, endedAtMs: 45 }).lastFrameDurationMs).toBe(0)
    expect(sampler.recordFrame({ durationMs: Number.POSITIVE_INFINITY }).lastFrameDurationMs).toBe(0)
  })

  it('returns defensive metric snapshots without exposing mutable accumulator state', () => {
    const sampler = createRenderFrameTimingSampler()
    const snapshot = sampler.recordFrame({ durationMs: 8, reasons: ['resize'] })

    snapshot.lastFrameReasons.push('debug')
    snapshot.reasonCounts.debug = 99

    expect(sampler.snapshot()).toEqual({
      frameCount: 1,
      renderCount: 1,
      activeAnimationFrameCount: 0,
      totalFrameDurationMs: 8,
      averageFrameDurationMs: 8,
      maxFrameDurationMs: 8,
      lastFrameDurationMs: 8,
      lastFrameHadActiveAnimation: false,
      lastFrameReasons: ['resize'],
      reasonCounts: {
        resize: 1,
      },
    })
  })

  it('resets aggregation state back to empty timing metrics', () => {
    const sampler = createRenderFrameTimingSampler()
    sampler.recordFrame({ durationMs: 12, activeAnimation: true, reasons: ['weather'] })

    expectEmptyTimingMetrics(sampler.reset())
    expectEmptyTimingMetrics(sampler.snapshot())

    expect(sampler.recordFrame({ durationMs: 4, rendered: false })).toMatchObject({
      frameCount: 1,
      renderCount: 0,
      activeAnimationFrameCount: 0,
      totalFrameDurationMs: 4,
      averageFrameDurationMs: 4,
      maxFrameDurationMs: 4,
      lastFrameDurationMs: 4,
      lastFrameHadActiveAnimation: false,
      lastFrameReasons: [],
      reasonCounts: {},
    })
  })
})
