import { describe, expect, it } from 'vitest'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  EncounterEffectTransferError,
  resolveEncounterEffectSwitchTransfer,
} from '~~/server/domain/moveAutomation/effectTransfer'
import {
  capabilityEncounterEffectFixture,
  conditionEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const RECALLED = 'baton-source'
const REPLACEMENT = 'baton-replacement'

const passableCoat = () => parseEncounterEffect({
  ...numericEncounterEffectFixture(),
  id: 'effect.coat.passable',
  source: {
    ...numericEncounterEffectFixture().source,
    placementId: RECALLED,
  },
  affected: { placementIds: [RECALLED], sideIds: [], cells: [] },
  tags: ['coat'],
  transferPolicy: 'baton-pass',
})

const passableStratagem = () => parseEncounterEffect({
  ...capabilityEncounterEffectFixture(),
  id: 'effect.stratagem.passable',
  source: {
    ...capabilityEncounterEffectFixture().source,
    placementId: RECALLED,
  },
  affected: { placementIds: ['other-target'], sideIds: [], cells: [] },
  tags: ['stratagem'],
  transferPolicy: 'baton-pass',
})

const expiringState = () => parseEncounterEffect({
  ...conditionEncounterEffectFixture(),
  id: 'effect.state.expiring',
  source: {
    ...conditionEncounterEffectFixture().source,
    placementId: RECALLED,
  },
  affected: { placementIds: [RECALLED], sideIds: [], cells: [] },
  transferPolicy: 'expire',
})

describe('encounter effect switch transfer policies', () => {
  it('rebinds passable effects once and expires non-passable source state before cleanup', () => {
    const expiring = expiringState()
    const retained = parseEncounterEffect({
      ...numericEncounterEffectFixture(),
      id: 'effect.state.retained',
      source: {
        ...numericEncounterEffectFixture().source,
        placementId: RECALLED,
      },
      affected: { placementIds: ['other-target'], sideIds: [], cells: [] },
      transferPolicy: 'retain',
      suppression: {
        sources: [{
          effectId: expiring.id,
          reasonCode: 'expiring-state.suppresses-retained',
        }],
      },
    })
    const effects = [passableCoat(), passableStratagem(), expiring, retained]
    const before = structuredClone(effects)

    const result = resolveEncounterEffectSwitchTransfer({
      effects,
      recalledPlacementId: RECALLED,
      sentOutPlacementId: REPLACEMENT,
      stateTransferPolicy: 'baton-pass',
    })

    expect(result.transferredEffectIds).toEqual([
      'effect.coat.passable',
      'effect.stratagem.passable',
    ])
    expect(result.expiredEffectIds).toEqual(['effect.state.expiring'])
    expect(result.effects.map(effect => effect.id)).toEqual([
      'effect.coat.passable',
      'effect.stratagem.passable',
      'effect.state.retained',
    ])
    expect(new Set(result.effects.map(effect => effect.id)).size).toBe(result.effects.length)
    expect(result.effects[0]).toMatchObject({
      source: { placementId: REPLACEMENT },
      affected: { placementIds: [REPLACEMENT] },
      transferPolicy: 'baton-pass',
    })
    expect(result.effects[1]).toMatchObject({
      source: { placementId: REPLACEMENT },
      affected: { placementIds: ['other-target'] },
    })
    expect(result.effects[2]).toMatchObject({
      source: { placementId: RECALLED },
      suppression: { sources: [] },
    })
    expect(result.transitions.map(transition => transition.kind)).toEqual([
      'removed',
      'suppression-cleared',
    ])
    expect(effects).toEqual(before)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.effects)).toBe(true)
  })

  it('expires Baton Pass-only effects on an ordinary switch without copying an instance', () => {
    const result = resolveEncounterEffectSwitchTransfer({
      effects: [passableCoat(), expiringState()],
      recalledPlacementId: RECALLED,
      sentOutPlacementId: REPLACEMENT,
      stateTransferPolicy: 'none',
    })

    expect(result.transferredEffectIds).toEqual([])
    expect(result.expiredEffectIds).toEqual([
      'effect.coat.passable',
      'effect.state.expiring',
    ])
    expect(result.effects).toEqual([])
  })

  it('fails closed when rebinding would duplicate an affected placement', () => {
    const conflicting = parseEncounterEffect({
      ...passableCoat(),
      affected: {
        placementIds: [RECALLED, REPLACEMENT],
        sideIds: [],
        cells: [],
      },
    })

    expect(() => resolveEncounterEffectSwitchTransfer({
      effects: [conflicting],
      recalledPlacementId: RECALLED,
      sentOutPlacementId: REPLACEMENT,
      stateTransferPolicy: 'baton-pass',
    })).toThrowError(expect.objectContaining({
      name: EncounterEffectTransferError.name,
      code: 'effect-transfer-conflict',
    }))
  })
})
