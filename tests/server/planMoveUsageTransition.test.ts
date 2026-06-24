import { describe, expect, it } from 'vitest'
import {
  MoveUsageTransitionError,
  planMoveUsageTransition,
} from '../../server/domain/planMoveUsageTransition'
import type { TabletopMap } from '~/types/map'
import type { SheetMoveUsageState } from '~/types/moveUsage'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'usage-plan-test',
  name: 'Usage Plan Test',
  dimensions: { x: 4, y: 2, z: 4 },
  voxels: [],
  placements: [],
  activeScene: { name: 'Scene A', startedAt: 100 },
  initiative: { round: 1 },
  ...overrides,
})

const transition = (overrides: {
  map?: Partial<TabletopMap>
  sheetMoveUsage?: SheetMoveUsageState
  frequency?: string
  usedAt?: number
} = {}) => planMoveUsageTransition({
  map: mapFixture(overrides.map),
  sheetMoveUsage: overrides.sheetMoveUsage,
  placementId: 'actor-token',
  move: {
    moveName: 'Test Move',
    moveKey: 'test-move',
    frequency: overrides.frequency ?? 'EOT',
  },
  usedAt: overrides.usedAt ?? 1234,
})

const expectUsageFailure = (
  run: () => unknown,
  code: MoveUsageTransitionError['code'],
): MoveUsageTransitionError => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(MoveUsageTransitionError)
    expect((error as MoveUsageTransitionError).code).toBe(code)
    return error as MoveUsageTransitionError
  }
  throw new Error(`Expected ${code}`)
}

describe('planMoveUsageTransition', () => {
  it('advances EOT usage once and rejects a blocked same-round EOT move', () => {
    const first = transition({ frequency: 'EOT' })
    expect(first.tracking).toBe('map')
    expect(first.usage).toMatchObject({ uses: 1, lastUsedRound: 1, available: false })
    expect(first.nextMapMoveUsage?.byPlacementId['actor-token']?.['test-move']).toMatchObject({
      frequency: 'eot',
      uses: 1,
      lastUsedRound: 1,
      updatedAt: 1234,
    })

    const error = expectUsageFailure(() => transition({
      frequency: 'EOT',
      map: { moveUsage: first.nextMapMoveUsage },
    }), 'eot-unavailable')
    expect(error.currentUsage).toMatchObject({ uses: 1, available: false, nextAvailableRound: 3 })
  })

  it('advances Scene usage and rejects when scene uses are spent', () => {
    const first = transition({ frequency: 'Scene' })
    expect(first.usage).toMatchObject({ uses: 1, maxUses: 1, remainingUses: 0, available: false })
    expect(first.nextMapMoveUsage?.byPlacementId['actor-token']?.['test-move']).toMatchObject({
      frequency: 'scene',
      uses: 1,
    })

    expectUsageFailure(() => transition({
      frequency: 'Scene',
      map: { moveUsage: first.nextMapMoveUsage },
    }), 'scene-unavailable')
  })

  it('updates Daily sheet usage and once-per-Scene map usage together', () => {
    const first = transition({ frequency: 'Daily x2' })
    expect(first.tracking).toBe('sheet')
    expect(first.usage).toMatchObject({
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      sceneUses: 1,
      sceneMaxUses: 1,
      sceneRemainingUses: 0,
      sceneAvailable: false,
      available: false,
    })
    expect(first.nextSheetMoveUsage?.daily['test-move']).toEqual({ moveName: 'Test Move', uses: 1, updatedAt: 1234 })
    expect(first.nextMapMoveUsage?.byPlacementId['actor-token']?.['test-move']).toMatchObject({ frequency: 'daily', uses: 1 })

    expectUsageFailure(() => transition({
      frequency: 'Daily x2',
      sheetMoveUsage: first.nextSheetMoveUsage,
      map: { moveUsage: first.nextMapMoveUsage },
    }), 'daily-scene-unavailable')
  })

  it('rejects Daily moves when persistent Daily usage is spent', () => {
    expectUsageFailure(() => transition({
      frequency: 'Daily x2',
      sheetMoveUsage: { daily: { 'test-move': { moveName: 'Test Move', uses: 2 } } },
    }), 'daily-unavailable')
  })

  it('leaves untracked moves without map or sheet usage state', () => {
    const result = transition({ frequency: 'At-Will' })
    expect(result.tracking).toBe('none')
    expect(result.previousUsage).toEqual(result.usage)
    expect(result.nextMapMoveUsage).toBeUndefined()
    expect(result.nextSheetMoveUsage).toBeUndefined()
  })
})
