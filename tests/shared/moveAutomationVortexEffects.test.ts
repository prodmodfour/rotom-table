import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  parseEncounterEffectDefinition,
} from '#shared/moveAutomation/encounterEffects'
import {
  SAND_TOMB_VORTEX_DEFINITION,
  createVortexEffect,
  parseVortexEffect,
  parseVortexEffectDefinition,
  vortexEffectId,
} from '~~/server/domain/moveAutomation/vortex'

const effect = () => createVortexEffect({
  definition: SAND_TOMB_VORTEX_DEFINITION,
  operationId: 'sand-tomb.vortex',
  moveId: 'move.sand-tomb',
  sourcePlacementId: 'actor-token',
  targetPlacementId: 'target-token',
  createdRound: 3,
  createdTurn: 8,
})

describe('shared Vortex encounter effect contract', () => {
  it('round-trips one bounded target-local payload with source/type and escape state', () => {
    expect(parseEncounterEffectDefinition(SAND_TOMB_VORTEX_DEFINITION)).toEqual(
      SAND_TOMB_VORTEX_DEFINITION,
    )
    expect(parseVortexEffectDefinition(SAND_TOMB_VORTEX_DEFINITION)).toEqual(
      SAND_TOMB_VORTEX_DEFINITION,
    )

    const parsed = parseVortexEffect(JSON.parse(JSON.stringify(effect())))
    expect(parseEncounterEffect(parsed)).toEqual(parsed)
    expect(parsed).toMatchObject({
      id: vortexEffectId('target-token'),
      kind: 'vortex',
      source: {
        operationId: 'sand-tomb.vortex',
        moveId: 'move.sand-tomb',
        placementId: 'actor-token',
      },
      affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
      duration: { kind: 'scene', remaining: null },
      charges: 4,
      payload: {
        sourceType: 'ground',
        tickPercent: 10,
        escapeDcs: [20, 14, 8, 2],
      },
    })
  })

  it('rejects unbounded, non-descending, and policy-inconsistent payloads', () => {
    expect(() => parseEncounterEffectDefinition({
      ...SAND_TOMB_VORTEX_DEFINITION,
      payload: { ...SAND_TOMB_VORTEX_DEFINITION.payload, escapeDcs: [] },
    })).toThrow('escapeDcs: must contain at least one escape DC')
    expect(() => parseEncounterEffectDefinition({
      ...SAND_TOMB_VORTEX_DEFINITION,
      payload: { ...SAND_TOMB_VORTEX_DEFINITION.payload, escapeDcs: [20, 20] },
      charges: 2,
    })).toThrow('must be lower than the preceding escape DC')
    expect(() => parseEncounterEffectDefinition({
      ...SAND_TOMB_VORTEX_DEFINITION,
      charges: 3,
    })).toThrow('one charge per escape DC')
    expect(() => parseEncounterEffectDefinition({
      ...SAND_TOMB_VORTEX_DEFINITION,
      stackPolicy: { kind: 'refresh', maxStacks: null },
    })).toThrow('replace stacking')
    expect(() => parseEncounterEffect({
      ...effect(),
      affected: { placementIds: ['target-token', 'other-token'], sideIds: [], cells: [] },
    })).toThrow('must directly affect exactly one placement')
    expect(() => parseEncounterEffect({
      ...effect(),
      payload: { ...effect().payload, unexpected: true },
    })).toThrow('unknown unexpected')
  })
})
