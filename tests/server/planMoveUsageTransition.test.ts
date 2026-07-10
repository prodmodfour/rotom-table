import { describe, expect, it } from 'vitest'
import {
  MoveUsageTransitionError,
  planMoveUsageTransition,
  type MoveUsageTransitionChange,
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
  change?: MoveUsageTransitionChange
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
  ...(overrides.change === undefined ? {} : { change: overrides.change }),
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

  it('applies bounded spend, restore, and set changes without losing clear intent', () => {
    const spent = transition({
      frequency: 'Scene x3',
      sheetMoveUsage: { daily: { other: { moveName: 'Other', uses: 1 } } },
      change: { action: 'spend', amount: 2 },
    })
    expect(spent).toMatchObject({
      mapUsageChanged: true,
      sheetUsageChanged: false,
      previousUsage: { uses: 0 },
      usage: { uses: 2, remainingUses: 1 },
    })
    expect(spent.nextSheetMoveUsage).toBeUndefined()

    const restored = transition({
      frequency: 'Scene x3',
      map: { moveUsage: spent.nextMapMoveUsage },
      change: { action: 'restore', amount: 2 },
    })
    expect(restored).toMatchObject({
      mapUsageChanged: true,
      previousUsage: { uses: 2 },
      usage: { uses: 0, remainingUses: 3 },
    })
    expect(restored.nextMapMoveUsage).toBeUndefined()

    const set = transition({
      frequency: 'Scene x3',
      change: { action: 'set', amount: 2 },
    })
    expect(set.usage).toMatchObject({ uses: 2, remainingUses: 1 })
    expect(set.nextMapMoveUsage?.byPlacementId['actor-token']?.['test-move']?.uses).toBe(2)
  })

  it('restores Daily map and sheet usage as one explicit two-resource change', () => {
    const spent = transition({ frequency: 'Daily x2' })
    const restored = transition({
      frequency: 'Daily x2',
      map: { moveUsage: spent.nextMapMoveUsage },
      sheetMoveUsage: spent.nextSheetMoveUsage,
      change: { action: 'restore', amount: 1 },
    })

    expect(restored).toMatchObject({
      mapUsageChanged: true,
      sheetUsageChanged: true,
      previousUsage: { uses: 1, sceneUses: 1 },
      usage: { uses: 0, sceneUses: 0, available: true },
    })
    expect(restored.nextMapMoveUsage).toBeUndefined()
    expect(restored.nextSheetMoveUsage).toBeUndefined()
  })

  it('rejects invalid typed usage changes before deriving state', () => {
    expectUsageFailure(() => transition({
      frequency: 'Scene',
      change: { action: 'spend', amount: -1 },
    }), 'invalid-usage-amount')
  })

  it('leaves untracked moves without map or sheet usage state', () => {
    const result = transition({ frequency: 'At-Will' })
    expect(result.tracking).toBe('none')
    expect(result.previousUsage).toEqual(result.usage)
    expect(result.mapUsageChanged).toBe(false)
    expect(result.sheetUsageChanged).toBe(false)
    expect(result.nextMapMoveUsage).toBeUndefined()
    expect(result.nextSheetMoveUsage).toBeUndefined()
  })
})
