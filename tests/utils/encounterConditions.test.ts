import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterConditionEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  EffectiveConditionProjectionError,
  projectEffectiveConditions,
} from '~/utils/encounterConditions'
import {
  capabilityEncounterEffectFixture,
  conditionEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const conditionEffect = (
  id: string,
  overrides: Partial<EncounterConditionEffect> = {},
): EncounterConditionEffect => parseEncounterEffect({
  ...conditionEncounterEffectFixture(),
  id,
  source: {
    ...conditionEncounterEffectFixture().source,
    operationId: `op_${id.replaceAll('.', '_')}`,
  },
  ...overrides,
}) as EncounterConditionEffect

const target = {
  placementId: 'target-token',
  sideId: 'allies',
  position: { x: 1, y: 0, z: 1 },
  base: 2,
  clearance: 2,
} as const

describe('effective encounter condition projection', () => {
  it('keeps legacy sheet strings and merges applicable direct, side, and cell effects once', () => {
    const duplicateBurn = conditionEffect('effect.condition.burn', {
      payload: { conditionId: 'burned', action: 'apply' },
    })
    const sideSleep = conditionEffect('effect.condition.sleep', {
      affected: { placementIds: [], sideIds: ['allies'], cells: [] },
      payload: { conditionId: 'sleep', action: 'apply' },
      duration: { kind: 'rounds', boundary: 'end', remaining: 2 },
    })
    const cellPoison = conditionEffect('effect.condition.poison', {
      affected: { placementIds: [], sideIds: [], cells: [{ x: 2, y: 1, z: 2 }] },
      payload: { conditionId: 'poisoned', action: 'apply' },
    })
    const unrelated = conditionEffect('effect.condition.unrelated', {
      affected: { placementIds: ['other-token'], sideIds: [], cells: [] },
      payload: { conditionId: 'yawn', action: 'apply' },
    })

    const projection = projectEffectiveConditions({
      sheetConditions: ['burnt', 'Burned'],
      encounterEffects: [duplicateBurn, sideSleep, cellPoison, unrelated],
      target,
    })

    expect(projection.sheetConditions).toEqual(['Burned'])
    expect(projection.conditions).toEqual(['Burned', 'Poisoned', 'Sleep'])
    expect(projection.modifiers.map(({ condition, effect }) => ({
      condition,
      effectId: effect.id,
      source: effect.source,
      duration: effect.duration,
      payload: effect.payload,
    }))).toEqual([
      expect.objectContaining({ condition: 'Burned', effectId: duplicateBurn.id }),
      expect.objectContaining({
        condition: 'Sleep',
        effectId: sideSleep.id,
        duration: { kind: 'rounds', boundary: 'end', remaining: 2 },
        payload: { conditionId: 'sleep', action: 'apply' },
      }),
      expect.objectContaining({ condition: 'Poisoned', effectId: cellPoison.id }),
    ])
    expect(projection.modifiers[0]?.effect).not.toBe(duplicateBurn)
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.modifiers[0]?.effect.source)).toBe(true)
  })

  it('retains source, timing, and payload for delayed source-linked conditions', () => {
    const delayedYawn = conditionEffect('effect.condition.delayed-yawn', {
      duration: { kind: 'until-triggered', remaining: null },
      payload: { conditionId: 'yawn', action: 'apply' },
    })

    const projection = projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: [delayedYawn],
      target,
    })

    expect(projection.conditions).toEqual(['Yawn'])
    expect(projection.modifiers).toEqual([{
      condition: 'Yawn',
      effect: delayedYawn,
    }])
    expect(projection.modifiers[0]).toMatchObject({
      effect: {
        source: delayedYawn.source,
        duration: { kind: 'until-triggered', remaining: null },
        payload: { conditionId: 'yawn', action: 'apply' },
      },
    })
  })

  it('applies suppress modifiers, exposes prevent modifiers, and ignores inactive effects', () => {
    const suppressBurn = conditionEffect('effect.condition.suppress-burn', {
      payload: { conditionId: 'burned', action: 'suppress' },
    })
    const preventPoison = conditionEffect('effect.condition.prevent-poison', {
      payload: { conditionId: 'poisoned', action: 'prevent' },
    })
    const suppressor = {
      ...capabilityEncounterEffectFixture(),
      id: 'effect.condition-suppressor',
    }
    const inactiveSleep = conditionEffect('effect.condition.inactive-sleep', {
      payload: { conditionId: 'sleep', action: 'apply' },
      suppression: {
        sources: [{ effectId: suppressor.id, reasonCode: 'condition.temporarily-suppressed' }],
      },
    })
    const depletedYawn = conditionEffect('effect.condition.depleted-yawn', {
      payload: { conditionId: 'yawn', action: 'apply' },
      charges: 0,
    })

    const projection = projectEffectiveConditions({
      sheetConditions: ['Burned'],
      encounterEffects: [suppressor, suppressBurn, preventPoison, inactiveSleep, depletedYawn],
      target,
    })

    expect(projection.conditions).toEqual([])
    expect(projection.modifiers.map(({ condition, effect }) => [
      condition,
      effect.payload.action,
    ])).toEqual([
      ['Burned', 'suppress'],
      ['Poisoned', 'prevent'],
    ])
  })

  it('preserves explicit stack counts while deduplicating ordinary cross-layer conditions', () => {
    const flinch = conditionEffect('effect.condition.flinch-stack', {
      stacks: 2,
      stackPolicy: { kind: 'add-stack', maxStacks: 4 },
      payload: { conditionId: 'flinch', action: 'apply' },
    })
    const sleep = conditionEffect('effect.condition.sleep-again', {
      payload: { conditionId: 'sleep', action: 'apply' },
    })

    const projection = projectEffectiveConditions({
      sheetConditions: ['Flinch', 'Sleep'],
      encounterEffects: [flinch, sleep],
      target,
    })

    expect(projection.conditions.filter(condition => condition === 'Flinch')).toHaveLength(3)
    expect(projection.conditions.filter(condition => condition === 'Vulnerable')).toHaveLength(1)
    expect(projection.conditions.filter(condition => condition === 'Sleep')).toHaveLength(1)
    expect(projection.modifiers[0]?.effect.stacks).toBe(2)
  })

  it('fails closed when typed encounter data names an unknown canonical condition', () => {
    const unknown = conditionEffect('effect.condition.unknown', {
      payload: { conditionId: 'not-a-canonical-condition', action: 'apply' },
    })

    expect(() => projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: [unknown],
      target,
    })).toThrowError(expect.objectContaining({
      name: EffectiveConditionProjectionError.name,
      code: 'unknown-condition',
      effectId: unknown.id,
    }))
  })
})
