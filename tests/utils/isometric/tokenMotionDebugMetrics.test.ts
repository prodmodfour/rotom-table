import { describe, expect, it } from 'vitest'
import { startTokenMotionTrack } from '~/utils/isometric/tokenMotionTracks'
import {
  TOKEN_MOTION_DEBUG_REASONS,
  createEmptyTokenMotionDebugMetrics,
  createTokenMotionDebugMetricsSampler,
  type TokenMotionDebugRenderObject,
} from '~/utils/isometric/tokenMotionDebugMetrics'

const track = (overrides: Partial<Parameters<typeof startTokenMotionTrack>[0]> = {}) => startTokenMotionTrack({
  tokenId: 'private-token-id-not-rendered',
  origin: { x: 0, y: 0, z: 0 },
  destination: { x: 4, y: 0, z: 0 },
  startMs: 1_000,
  durationMs: 300,
  reason: 'local-prediction',
  ...overrides,
})

const reasonRow = (
  metrics: ReturnType<typeof createEmptyTokenMotionDebugMetrics>,
  reason: (typeof TOKEN_MOTION_DEBUG_REASONS)[number],
) => metrics.sourceReasonCounts.find((row) => row.reason === reason)

describe('token motion debug metrics', () => {
  it('creates an empty privacy-preserving metrics snapshot', () => {
    const metrics = createEmptyTokenMotionDebugMetrics()

    expect(metrics.activeMovingTokenCount).toBe(0)
    expect(metrics.longestActiveMotionAgeMs).toBeNull()
    expect(metrics.completedMotionCount).toBe(0)
    expect(metrics.sourceReasonCounts.map((row) => row.reason)).toEqual(TOKEN_MOTION_DEBUG_REASONS)
    expect(metrics.sourceReasonCounts.every((row) => (
      row.activeCount === 0
      && row.startedCount === 0
      && row.completedCount === 0
    ))).toBe(true)
    expect(JSON.stringify(metrics)).not.toContain('private-token-id-not-rendered')
  })

  it('counts active moving tokens and their longest active age by source reason', () => {
    const sampler = createTokenMotionDebugMetricsSampler()
    const localTrack = track({ reason: 'local-prediction', startMs: 1_000 })
    const remoteTrack = track({ tokenId: 'other-private-id', reason: 'remote-accepted', startMs: 1_250 })
    const renderObjects: TokenMotionDebugRenderObject[] = [
      { motion: { track: localTrack } },
      { motion: { track: remoteTrack } },
      { motion: {} },
    ]

    sampler.recordMotionStarted(localTrack)
    sampler.recordMotionStarted(remoteTrack)
    const metrics = sampler.snapshot({ renderObjects, nowMs: 1_500 })

    expect(metrics.activeMovingTokenCount).toBe(2)
    expect(metrics.longestActiveMotionAgeMs).toBe(500)
    expect(reasonRow(metrics, 'local-prediction')).toMatchObject({ activeCount: 1, startedCount: 1 })
    expect(reasonRow(metrics, 'remote-accepted')).toMatchObject({ activeCount: 1, startedCount: 1 })
    expect(JSON.stringify(metrics)).not.toContain('other-private-id')
  })

  it('records completed motion counts without treating completion as authority', () => {
    const sampler = createTokenMotionDebugMetricsSampler()
    const correctionTrack = track({ reason: 'server-correction' })
    const reconciliationTrack = track({ reason: 'reconciliation' })

    sampler.recordMotionStarted(correctionTrack)
    sampler.recordMotionStarted(reconciliationTrack)
    sampler.recordMotionCompleted(correctionTrack)
    const metrics = sampler.snapshot({
      renderObjects: [{ motion: { track: reconciliationTrack } }],
      nowMs: 1_100,
    })

    expect(metrics.completedMotionCount).toBe(1)
    expect(reasonRow(metrics, 'server-correction')).toMatchObject({
      activeCount: 0,
      startedCount: 1,
      completedCount: 1,
    })
    expect(reasonRow(metrics, 'reconciliation')).toMatchObject({
      activeCount: 1,
      startedCount: 1,
      completedCount: 0,
    })
  })

  it('can reset cumulative debug counters while keeping active track sampling pure', () => {
    const sampler = createTokenMotionDebugMetricsSampler()
    const setupTrack = track({ reason: 'setup-edit', startMs: 2_000 })

    sampler.recordMotionStarted(setupTrack)
    sampler.recordMotionCompleted(setupTrack)
    sampler.reset()

    const metrics = sampler.snapshot({
      renderObjects: [{ motion: { track: setupTrack } }],
      nowMs: 2_125,
    })

    expect(metrics.completedMotionCount).toBe(0)
    expect(reasonRow(metrics, 'setup-edit')).toMatchObject({
      activeCount: 1,
      startedCount: 0,
      completedCount: 0,
    })
  })
})
