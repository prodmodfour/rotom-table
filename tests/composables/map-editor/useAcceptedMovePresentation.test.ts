import { describe, expect, it, vi } from 'vitest'
import type { LivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import {
  planAcceptedMovePresentation,
  useAcceptedMovePresentation,
} from '~/composables/map-editor/useAcceptedMovePresentation'
import { MOVE_VFX_KIND } from '~/types/moveAnimation'

const mixedAreaPresentation = (
  overrides: Partial<LivePlayMovePresentationSummary> = {},
): LivePlayMovePresentationSummary => ({
  schemaVersion: 1,
  operationId: 'op_present001',
  actorPlacementId: 'actor-token',
  move: { name: 'Swift', type: 'Normal' },
  attackedTargetIds: ['hit-token', 'miss-token'],
  hitTargetIds: ['hit-token'],
  outcomeKind: 'mixed',
  area: {
    templateKind: 'line',
    cells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    direction: 'east',
  },
  ...overrides,
})

describe('accepted move presentation', () => {
  it('lets a second client present a durable accepted result without a transient hint', () => {
    const enqueueMoveAnimations = vi.fn()
    const presenter = useAcceptedMovePresentation({
      enqueueMoveAnimations,
      nowMs: () => 2_000,
    })

    const result = presenter.present(mixedAreaPresentation())

    expect(result.status).toBe('presented')
    expect(enqueueMoveAnimations).toHaveBeenCalledTimes(1)
    expect(enqueueMoveAnimations).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'op_present001-accepted-area',
        kind: MOVE_VFX_KIND.lineSweep,
        areaCells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        areaDirection: 'east',
        createdAtMs: 2_000,
      }),
      expect.objectContaining({
        id: 'op_present001-accepted-hit-001',
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'hit-token',
      }),
      expect.objectContaining({
        id: 'op_present001-accepted-miss-002',
        kind: MOVE_VFX_KIND.miss,
        targetId: 'miss-token',
      }),
    ])
    expect(presenter.hasPresented('op_present001')).toBe(true)
  })

  it('dedupes duplicate HTTP, SSE, and status terminals by operation ID', () => {
    const enqueueMoveAnimations = vi.fn()
    const enqueueAndPublishMoveAnimations = vi.fn()
    const presenter = useAcceptedMovePresentation({
      enqueueMoveAnimations,
      enqueueAndPublishMoveAnimations,
      nowMs: () => 3_000,
    })
    const presentation = mixedAreaPresentation()

    const http = presenter.present(presentation, { publishHint: true })
    const sse = presenter.present(presentation)
    const status = presenter.present(presentation)

    expect(http.status).toBe('presented')
    expect(sse.status).toBe('duplicate')
    expect(status.status).toBe('duplicate')
    expect(enqueueAndPublishMoveAnimations).toHaveBeenCalledTimes(1)
    expect(enqueueMoveAnimations).not.toHaveBeenCalled()
  })

  it('plans accepted pass geometry and no-target self outcomes without move rules', () => {
    const pass = planAcceptedMovePresentation(mixedAreaPresentation({
      operationId: 'op_present002',
      attackedTargetIds: [],
      hitTargetIds: [],
      outcomeKind: 'no-target',
      area: {
        templateKind: 'pass',
        cells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        direction: 'east',
      },
      pass: {
        from: { x: 0, y: 0, z: 0 },
        destination: { x: 2, y: 0, z: 0 },
        pathCells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        direction: 'east',
      },
    }), 4_000)
    expect(pass).toEqual([
      expect.objectContaining({
        id: 'op_present002-accepted-pass',
        kind: MOVE_VFX_KIND.dash,
        originCell: { x: 0, y: 0, z: 0 },
        destinationCell: { x: 2, y: 0, z: 0 },
      }),
    ])

    const self = planAcceptedMovePresentation(mixedAreaPresentation({
      operationId: 'op_present003',
      attackedTargetIds: [],
      hitTargetIds: [],
      outcomeKind: 'self',
      area: undefined,
    }), 5_000)
    expect(self).toEqual([
      expect.objectContaining({
        id: 'op_present003-accepted-self',
        kind: MOVE_VFX_KIND.selfPulse,
      }),
    ])
  })
})
