import { describe, expect, it } from 'vitest'
import {
  applyStartTurnModalStateUpdate,
  normalizeStartTurnModalStateUpdatePayload,
  readStartTurnModalState,
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
        schemaVersion: 1,
        dismissedTurn: {
          activeId: 'token-pikachu',
          round: 2,
          dismissedAt: 1234,
        },
      },
    })
  })

  it('normalizes dismiss payloads', () => {
    expect(normalizeStartTurnModalStateUpdatePayload({
      action: 'dismiss',
      activeId: ' token-eevee ',
      round: 1,
    })).toEqual({
      action: 'dismiss',
      activeId: 'token-eevee',
      round: 1,
    })
    expect(normalizeStartTurnModalStateUpdatePayload({ action: 'dismiss', activeId: '', round: 1 })).toBeNull()
    expect(normalizeStartTurnModalStateUpdatePayload({ action: 'dismiss', activeId: 'token-eevee', round: 0 })).toBeNull()
  })
})
