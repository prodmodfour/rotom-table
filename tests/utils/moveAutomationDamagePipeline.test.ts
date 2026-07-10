import { describe, expect, it } from 'vitest'
import {
  MOVE_DAMAGE_PIPELINE_STAGES,
  MoveDamagePipelineError,
  resolveMoveDamagePipeline,
  type MoveDamageModifier,
  type MoveDamageNumericModifier,
} from '~/utils/moveAutomationDamagePipeline'

const modifier = (
  value: MoveDamageModifier,
): MoveDamageModifier => value

const completeModifiers = (): MoveDamageModifier[] => [
  modifier({
    id: 'damage.base-roll',
    stage: 'base-damage-base',
    priority: 0,
    source: { kind: 'move', id: 'Test Move' },
    stackingGroup: 'base-damage-roll',
    reasonCode: 'damage.base-roll',
    operation: 'set',
    value: 20,
  }),
  modifier({
    id: 'damage.attack-stat',
    stage: 'attack-stat',
    priority: 0,
    source: { kind: 'placement', id: 'actor-token' },
    stackingGroup: 'attack-stat',
    reasonCode: 'damage.attack-stat',
    operation: 'add',
    value: 10,
  }),
  modifier({
    id: 'damage.defense-stat',
    stage: 'defense-stat',
    priority: 0,
    source: { kind: 'placement', id: 'target-token' },
    stackingGroup: 'defense-stat',
    reasonCode: 'damage.defense-stat',
    operation: 'subtract',
    value: 8,
  }),
  modifier({
    id: 'damage.pre-type-late',
    stage: 'pre-type-modifiers',
    priority: 20,
    source: { kind: 'field', id: 'terrain' },
    stackingGroup: 'field-damage',
    reasonCode: 'damage.field-bonus',
    operation: 'add',
    value: 2,
  }),
  modifier({
    id: 'damage.pre-type-early',
    stage: 'pre-type-modifiers',
    priority: 10,
    source: { kind: 'condition', id: 'Helping Hand' },
    stackingGroup: 'condition-damage',
    reasonCode: 'damage.helping-hand',
    operation: 'add',
    value: 1,
  }),
  modifier({
    id: 'damage.type-effectiveness',
    stage: 'type-effectiveness',
    priority: 0,
    source: { kind: 'type', id: 'target-token' },
    stackingGroup: 'type-effectiveness',
    reasonCode: 'damage.type-effectiveness',
    operation: 'multiply-floor',
    value: 1.5,
  }),
  modifier({
    id: 'damage.critical-roll',
    stage: 'critical-modifiers',
    priority: 0,
    source: { kind: 'move', id: 'Test Move' },
    stackingGroup: 'critical-damage-roll',
    reasonCode: 'damage.critical-hit-roll',
    operation: 'add-before-type',
    value: 6,
  }),
  modifier({
    id: 'damage.post-type',
    stage: 'post-damage-modifiers',
    priority: 0,
    source: { kind: 'encounter-effect', id: 'effect.reflect' },
    stackingGroup: 'post-damage-reduction',
    reasonCode: 'damage.post-type-reduction',
    operation: 'subtract',
    value: 4,
  }),
  modifier({
    id: 'damage.minimum',
    stage: 'minimum-damage',
    priority: 0,
    source: { kind: 'rules', id: 'ptu.minimum-damage' },
    stackingGroup: 'minimum-damage',
    reasonCode: 'damage.minimum-one',
    operation: 'floor-at-least',
    value: 1,
  }),
  modifier({
    id: 'damage.final-non-negative',
    stage: 'final-hp-loss',
    priority: 0,
    source: { kind: 'rules', id: 'ptu.final-hp-loss' },
    stackingGroup: 'final-hp-loss',
    reasonCode: 'damage.final-non-negative',
    operation: 'floor-at-least',
    value: 0,
  }),
  modifier({
    id: 'damage.final-floor',
    stage: 'final-hp-loss',
    priority: 1,
    source: { kind: 'rules', id: 'ptu.final-hp-loss' },
    stackingGroup: 'final-hp-loss',
    reasonCode: 'damage.final-floor',
    operation: 'floor',
  }),
]

describe('ordered move damage pipeline', () => {
  it('runs every explicit stage and priority in stable order', () => {
    const forward = resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: completeModifiers(),
    })
    const reversed = resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: completeModifiers().reverse(),
    })

    expect(forward).toEqual(reversed)
    expect(forward.stages.map(stage => stage.stage)).toEqual(MOVE_DAMAGE_PIPELINE_STAGES)
    expect(forward.stages.map(stage => stage.output)).toEqual([
      20, // resolved DB roll
      30, // attack stat
      22, // defense stat
      25, // pre-type bonuses in priority order
      37, // floor(25 × 1.5)
      46, // floor((25 + 6 critical dice) × 1.5)
      42, // post-damage reduction
      42, // minimum did not change the result
      42, // final non-negative integer HP loss
    ])
    expect(forward.stages[3]?.modifiers.map(entry => entry.id)).toEqual([
      'damage.pre-type-early',
      'damage.pre-type-late',
    ])
    expect(forward).toMatchObject({
      damageBase: 6,
      preTypeDamage: 25,
      typeScaledDamage: 37,
      criticalScaledDamage: 46,
      postModifierDamage: 42,
      minimumDamageApplied: false,
      hpLoss: 42,
    })
    expect(Object.isFrozen(forward)).toBe(true)
    expect(Object.isFrozen(forward.stages)).toBe(true)
    expect(Object.isFrozen(forward.stages[0]?.modifiers[0]?.source)).toBe(true)
  })

  it('attributes every applied modifier in arithmetic trace evidence', () => {
    const result = resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: completeModifiers(),
    })

    const modifierTrace = result.stages.flatMap(stage => stage.modifiers)
    expect(modifierTrace).toHaveLength(completeModifiers().length)
    for (const entry of modifierTrace) {
      expect(entry).toEqual(expect.objectContaining({
        id: expect.any(String),
        stage: expect.any(String),
        priority: expect.any(Number),
        source: {
          kind: expect.any(String),
          id: expect.any(String),
        },
        stackingGroup: expect.any(String),
        reasonCode: expect.any(String),
        operation: expect.any(String),
        input: expect.any(Number),
        output: expect.any(Number),
      }))
    }
    expect(modifierTrace.find(entry => entry.id === 'damage.critical-roll')).toMatchObject({
      input: 37,
      output: 46,
      value: 6,
      reasonCode: 'damage.critical-hit-roll',
    })
    expect(result.stages[0]).toMatchObject({ damageBase: 6 })
    expect(result.stages.slice(1).every(stage => stage.damageBase === null)).toBe(true)
  })

  it('applies post-damage changes before the minimum and final HP-loss stages', () => {
    const modifiers = completeModifiers().map(entry => (
      entry.id === 'damage.post-type'
        ? { ...entry, operation: 'subtract' as const, value: 100 }
        : entry
    ))
    const result = resolveMoveDamagePipeline({ damageBase: 6, modifiers })

    expect(result.postModifierDamage).toBe(-54)
    expect(result.minimumDamageApplied).toBe(true)
    expect(result.hpLoss).toBe(1)
    expect(result.stages.at(-2)).toMatchObject({
      stage: 'minimum-damage',
      input: -54,
      output: 1,
    })
  })

  it('rejects duplicate, malformed, mis-staged, and unbounded modifiers', () => {
    const base = completeModifiers()[0] as MoveDamageNumericModifier
    expect(() => resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: [base, { ...base }],
    })).toThrowError(expect.objectContaining({
      name: MoveDamagePipelineError.name,
      code: 'duplicate-modifier-id',
      modifierId: 'damage.base-roll',
    }))

    expect(() => resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: [{
        ...base,
        id: 'damage.bad-critical',
        stage: 'attack-stat',
        operation: 'add-before-type',
      }],
    })).toThrowError(expect.objectContaining({ code: 'invalid-modifier-stage' }))

    expect(() => resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: [{ ...base, id: 'not stable' }],
    })).toThrowError(expect.objectContaining({ code: 'invalid-modifier' }))

    expect(() => resolveMoveDamagePipeline({
      damageBase: 6,
      modifiers: [{ ...base, value: Number.POSITIVE_INFINITY }],
    })).toThrowError(expect.objectContaining({ code: 'damage-value-out-of-range' }))
  })
})
