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
import { createItemTemporaryCombatEffect } from '../../server/domain/itemAutomation/combatEffects'
import {
  itemDigestionSheetTag,
  rebindItemDigestionEffectsForPlacement,
} from '../../server/domain/itemAutomation/digestionEffectIdentity'
import {
  ITEM_DIGESTION_EFFECT_TAG,
  ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX,
} from '../../server/domain/itemAutomation/digestionBuffTrade'

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

  it('retains a sheet-owned Snack across recall and rebinds only when that sheet returns', () => {
    const owner = { id: RECALLED, sheetKind: 'pokemon' as const, sheetSlug: 'snorlax' }
    const effect = parseEncounterEffect({
      ...numericEncounterEffectFixture(),
      id: 'effect.item.digestion.leftovers', kind: 'capability',
      source: { ...numericEncounterEffectFixture().source, placementId: RECALLED },
      affected: { placementIds: [RECALLED], sideIds: [], cells: [] },
      duration: { kind: 'encounter', remaining: null },
      tags: [ITEM_DIGESTION_EFFECT_TAG, itemDigestionSheetTag(owner)],
      payload: { capabilityId: `${ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX}16`, action: 'grant', value: 1 },
      transferPolicy: 'retain', suppression: { sources: [] },
    })
    const switched = resolveEncounterEffectSwitchTransfer({
      effects: [effect], recalledPlacementId: RECALLED,
      sentOutPlacementId: REPLACEMENT, stateTransferPolicy: 'none',
    })
    expect(switched.effects[0]?.affected.placementIds).toEqual([RECALLED])
    expect(rebindItemDigestionEffectsForPlacement({
      effects: switched.effects,
      placement: { ...owner, id: 'snorlax-returned' },
    })[0]).toMatchObject({
      source: { placementId: 'snorlax-returned' },
      affected: { placementIds: ['snorlax-returned'] },
    })
  })

  it('expires item-authored Dire Hit and Guard Spec on ordinary switch and Baton Pass', () => {
    const map = { initiative: { round: 2 }, encounterState: undefined }
    for (const stateTransferPolicy of ['none', 'baton-pass'] as const) {
      const itemEffects = [
        createItemTemporaryCombatEffect({
          operationId: 'op_item_dire_hit_transfer', canonicalItemId: 'Dire Hit',
          sourcePlacementId: 'trainer-source', targetPlacementId: RECALLED,
          family: 'critical-range', amount: 2,
          duration: { kind: 'encounter', amount: null }, stackPolicy: 'replace', map,
        }),
        createItemTemporaryCombatEffect({
          operationId: 'op_item_guard_spec_transfer', canonicalItemId: 'Guard Spec',
          sourcePlacementId: 'trainer-source', targetPlacementId: RECALLED,
          family: 'move-stage-reduction-immunity', amount: 5,
          duration: { kind: 'turns', amount: 5 }, stackPolicy: 'refresh', map,
        }),
      ]
      const result = resolveEncounterEffectSwitchTransfer({
        effects: itemEffects, recalledPlacementId: RECALLED,
        sentOutPlacementId: REPLACEMENT, stateTransferPolicy,
      })
      expect(result.transferredEffectIds).toEqual([])
      expect(result.expiredEffectIds).toEqual(itemEffects.map(effect => effect.id))
      expect(result.effects).toEqual([])
    }
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
