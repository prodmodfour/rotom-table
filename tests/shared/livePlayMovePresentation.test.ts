import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_PRESENTATION_MAX_CELLS,
  LIVE_PLAY_MOVE_PRESENTATION_MAX_TARGET_IDS,
  createLivePlayMovePresentationFromOutcome,
  parseLivePlayMovePresentationSummary,
  resolveLivePlayMovePresentationOutcomeKind,
} from '#shared/livePlayMovePresentation'

const summary = () => ({
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
})

describe('live-play accepted move presentation contract', () => {
  it('parses and detaches a bounded mixed area outcome', () => {
    const source = summary()
    const parsed = parseLivePlayMovePresentationSummary(source)

    expect(parsed.valid).toBe(true)
    if (!parsed.valid) return
    expect(parsed.presentation).toEqual(source)
    expect(parsed.presentation).not.toBe(source)
    expect(parsed.presentation.area?.cells).not.toBe(source.area.cells)
  })

  it('builds a runtime-neutral accepted summary for native MoveSpec outcomes', () => {
    const result = createLivePlayMovePresentationFromOutcome({
      operationId: 'op_presentv2001',
      actorPlacementId: 'actor-token',
      move: { name: 'Scratch', type: 'Normal' },
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      selectedTargetIds: ['target-token'],
      pass: {
        from: { x: 0, y: 0, z: 0 },
        destination: { x: 2, y: 0, z: 0 },
        pathCells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        direction: 'east',
      },
    })

    expect(result).toMatchObject({
      operationId: 'op_presentv2001',
      actorPlacementId: 'actor-token',
      move: { name: 'Scratch', type: 'Normal' },
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      outcomeKind: 'hit',
      pass: { destination: { x: 2, y: 0, z: 0 }, direction: 'east' },
    })
  })

  it('rejects unknown fields, inconsistent hits/outcomes, and invalid operation ids', () => {
    expect(parseLivePlayMovePresentationSummary({ ...summary(), extra: true }).valid).toBe(false)
    expect(parseLivePlayMovePresentationSummary({
      ...summary(),
      hitTargetIds: ['other-token'],
    }).valid).toBe(false)
    expect(parseLivePlayMovePresentationSummary({
      ...summary(),
      outcomeKind: 'hit',
    }).valid).toBe(false)
    expect(parseLivePlayMovePresentationSummary({
      ...summary(),
      operationId: 'not-an-operation',
    }).valid).toBe(false)
  })

  it('enforces explicit target and geometry bounds', () => {
    expect(parseLivePlayMovePresentationSummary({
      ...summary(),
      attackedTargetIds: Array.from(
        { length: LIVE_PLAY_MOVE_PRESENTATION_MAX_TARGET_IDS + 1 },
        (_, index) => `target-${index}`,
      ),
      hitTargetIds: [],
      outcomeKind: 'miss',
    }).valid).toBe(false)

    expect(parseLivePlayMovePresentationSummary({
      ...summary(),
      area: {
        ...summary().area,
        cells: Array.from(
          { length: LIVE_PLAY_MOVE_PRESENTATION_MAX_CELLS + 1 },
          (_, index) => ({ x: index, y: 0, z: 0 }),
        ),
      },
    }).valid).toBe(false)
  })

  it('classifies self, empty-area, hit, miss, and mixed outcomes deterministically', () => {
    expect(resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds: [],
      hitTargetIds: [],
      selectedTargetIds: [],
    })).toBe('self')
    expect(resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds: [],
      hitTargetIds: [],
      selectedTargetIds: [],
      area: {},
    })).toBe('no-target')
    expect(resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds: ['a'],
      hitTargetIds: [],
    })).toBe('miss')
    expect(resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds: ['a'],
      hitTargetIds: ['a'],
    })).toBe('hit')
    expect(resolveLivePlayMovePresentationOutcomeKind({
      attackedTargetIds: ['a', 'b'],
      hitTargetIds: ['a'],
    })).toBe('mixed')
  })
})
