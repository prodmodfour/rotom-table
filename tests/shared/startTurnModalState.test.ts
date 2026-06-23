import { describe, expect, it } from 'vitest'
import {
  applyStartTurnModalStateUpdate,
  normalizeStartTurnModalStateUpdatePayload,
  readStartTurnModalState,
  startTurnModalConditionSaveDc,
  startTurnModalIsDismissed,
  writeStartTurnModalState,
} from '#shared/startTurnModalState'

describe('startTurnModalState', () => {
  it('stores a single dismissed active turn in map metadata', () => {
    const state = applyStartTurnModalStateUpdate(
      readStartTurnModalState(undefined),
      { action: 'dismiss', activeId: 'token-pikachu', round: 2 },
      { dismissedAt: 1234 },
    )
    const metadata = writeStartTurnModalState({ other: true }, state)

    expect(startTurnModalIsDismissed(metadata, { activeId: 'token-pikachu', round: 2 })).toBe(true)
    expect(startTurnModalIsDismissed(metadata, { activeId: 'token-pikachu', round: 3 })).toBe(false)
    expect(startTurnModalIsDismissed(metadata, { activeId: 'token-eevee', round: 2 })).toBe(false)
    expect(metadata).toMatchObject({
      other: true,
      startTurnModal: {
        schemaVersion: 2,
        dismissedTurn: {
          activeId: 'token-pikachu',
          round: 2,
          dismissedAt: 1234,
        },
        conditionResolutions: [],
      },
    })
  })

  it('stores condition roll, skip, and remove results for the active turn', () => {
    const rolled = applyStartTurnModalStateUpdate(
      readStartTurnModalState(undefined),
      {
        action: 'resolveCondition',
        activeId: 'token-pikachu',
        round: 2,
        condition: 'Paralysis',
        occurrence: 0,
        resolution: 'roll',
      },
      { conditionRoll: 12, resolvedAt: 100 },
    )
    expect(rolled.conditionResolutions).toEqual([{
      activeId: 'token-pikachu',
      round: 2,
      condition: 'Paralysis',
      occurrence: 0,
      resolution: 'roll',
      roll: 12,
      dc: 11,
      success: true,
      resolvedAt: 100,
    }])

    const skipped = applyStartTurnModalStateUpdate(
      rolled,
      {
        action: 'resolveCondition',
        activeId: 'token-pikachu',
        round: 2,
        condition: 'Burned',
        occurrence: 0,
        resolution: 'skip',
      },
      { resolvedAt: 101 },
    )
    expect(skipped.conditionResolutions).toHaveLength(2)
    expect(skipped.conditionResolutions[1]).toMatchObject({
      condition: 'Burned',
      resolution: 'skip',
      roll: null,
      dc: null,
      success: null,
      resolvedAt: 101,
    })

    const removedNextTurn = applyStartTurnModalStateUpdate(
      skipped,
      {
        action: 'resolveCondition',
        activeId: 'token-eevee',
        round: 3,
        condition: 'Sleep',
        occurrence: 0,
        resolution: 'remove',
      },
      { resolvedAt: 102 },
    )
    expect(removedNextTurn.conditionResolutions).toEqual([expect.objectContaining({
      activeId: 'token-eevee',
      round: 3,
      condition: 'Sleep',
      resolution: 'remove',
      resolvedAt: 102,
    })])
  })

  it('normalizes update payloads', () => {
    expect(normalizeStartTurnModalStateUpdatePayload({
      action: 'dismiss',
      activeId: ' token-eevee ',
      round: 1,
    })).toEqual({
      action: 'dismiss',
      activeId: 'token-eevee',
      round: 1,
    })
    expect(normalizeStartTurnModalStateUpdatePayload({
      action: 'resolveCondition',
      activeId: ' token-eevee ',
      round: 1,
      condition: ' Paralysis ',
      resolution: 'roll',
    })).toEqual({
      action: 'resolveCondition',
      activeId: 'token-eevee',
      round: 1,
      condition: 'Paralysis',
      occurrence: 0,
      resolution: 'roll',
    })
    expect(normalizeStartTurnModalStateUpdatePayload({ action: 'dismiss', activeId: '', round: 1 })).toBeNull()
    expect(normalizeStartTurnModalStateUpdatePayload({ action: 'dismiss', activeId: 'token-eevee', round: 0 })).toBeNull()
    expect(normalizeStartTurnModalStateUpdatePayload({
      action: 'resolveCondition',
      activeId: 'token-eevee',
      round: 1,
      condition: 'Paralysis',
      resolution: 'reroll',
    })).toBeNull()
  })

  it('knows common condition save DCs', () => {
    expect(startTurnModalConditionSaveDc('Paralysis')).toBe(11)
    expect(startTurnModalConditionSaveDc('Infatuation: Eevee')).toBe(16)
    expect(startTurnModalConditionSaveDc('Burned')).toBeNull()
  })
})
