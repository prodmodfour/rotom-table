import { describe, expect, it } from 'vitest'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  moveUsageKey,
  normalizeMapMoveUsage,
  parseMoveFrequency,
  recordMapMoveUsage,
  recordSheetDailyMoveUsage,
} from '~/utils/moveUsage'


describe('move usage helpers', () => {
  it('builds stable move keys', () => {
    expect(moveUsageKey("Farfetch’d Fury!")).toBe('farfetchd-fury')
  })

  it('parses PTU move frequency scopes and multipliers', () => {
    expect(parseMoveFrequency('At-Will – Free Action')).toMatchObject({ kind: 'at-will', usesPerPeriod: null })
    expect(parseMoveFrequency('EOT')).toMatchObject({ kind: 'eot', usesPerPeriod: 1 })
    expect(parseMoveFrequency('Scene x2')).toMatchObject({ kind: 'scene', usesPerPeriod: 2 })
    expect(parseMoveFrequency('Daily x3')).toMatchObject({ kind: 'daily', usesPerPeriod: 3 })
    expect(parseMoveFrequency('See Text')).toMatchObject({ kind: 'see-text', usesPerPeriod: null })
  })

  it('records and normalizes map-scoped move usage', () => {
    const usage = recordMapMoveUsage({
      usage: undefined,
      placementId: 'token-1',
      moveKey: 'thunderbolt',
      moveName: 'Thunderbolt',
      frequency: 'scene',
      currentRound: 2,
      usedAt: 100,
    })

    expect(getMapMoveUsageEntry(usage, 'token-1', 'thunderbolt')).toEqual({
      moveName: 'Thunderbolt',
      frequency: 'scene',
      uses: 1,
      lastUsedRound: 2,
      updatedAt: 100,
    })

    const normalized = normalizeMapMoveUsage({
      byPlacementId: {
        'token-1': {
          Thunderbolt: { moveName: 'Thunderbolt', frequency: 'scene', uses: 2 },
          Broken: { moveName: '', frequency: 'scene', uses: 1 },
        },
      },
    })
    expect(normalized).toEqual({
      byPlacementId: {
        'token-1': {
          thunderbolt: { moveName: 'Thunderbolt', frequency: 'scene', uses: 2 },
        },
      },
    })
  })

  it('reports EOT and limited-use availability', () => {
    expect(eotMoveUsageState(null, 1)).toMatchObject({ available: true })
    expect(eotMoveUsageState({ moveName: 'Bite', frequency: 'eot', uses: 1, lastUsedRound: 4 }, 5))
      .toMatchObject({ available: false, nextAvailableRound: 6 })
    expect(eotMoveUsageState({ moveName: 'Bite', frequency: 'eot', uses: 1, lastUsedRound: 4 }, 6))
      .toMatchObject({ available: true, nextAvailableRound: 6 })

    expect(limitedMoveUsageState({ uses: 1 }, 2)).toEqual({
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      available: true,
    })
    expect(limitedMoveUsageState({ uses: 2 }, 2)).toMatchObject({ remainingUses: 0, available: false })
  })

  it('records sheet-scoped daily move usage', () => {
    const usage = recordSheetDailyMoveUsage({
      usage: undefined,
      moveKey: 'shadow-force',
      moveName: 'Shadow Force',
      usedAt: 200,
    })

    expect(getSheetDailyMoveUsageEntry(usage, 'shadow-force')).toEqual({
      moveName: 'Shadow Force',
      uses: 1,
      updatedAt: 200,
    })
  })
})
