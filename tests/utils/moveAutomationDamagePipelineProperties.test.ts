import { describe, expect, it } from 'vitest'
import {
  MOVE_DAMAGE_PIPELINE_STAGES,
  resolveMoveDamagePipeline,
  type MoveDamageModifier,
  type MoveDamagePipelineStage,
} from '~/utils/moveAutomationDamagePipeline'
import {
  createDeterministicPropertyGenerator,
  type DeterministicPropertyGenerator,
} from '../fixtures/moveAutomation/mechanicsProperties'

const STAGE_INDEX = new Map<MoveDamagePipelineStage, number>(
  MOVE_DAMAGE_PIPELINE_STAGES.map((stage, index) => [stage, index]),
)

const compareText = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const compareModifierOrder = (
  left: MoveDamageModifier,
  right: MoveDamageModifier,
): number => (
  (STAGE_INDEX.get(left.stage)! - STAGE_INDEX.get(right.stage)!)
  || (left.priority - right.priority)
  || compareText(left.stackingGroup, right.stackingGroup)
  || compareText(left.source.kind, right.source.kind)
  || compareText(left.source.id, right.source.id)
  || compareText(left.id, right.id)
)

const generatedModifiers = (
  generated: DeterministicPropertyGenerator,
  caseIndex: number,
): MoveDamageModifier[] => {
  const sameStage: MoveDamageModifier[] = Array.from({ length: 8 }, (_unused, index) => {
    const operation = generated.pick(['add', 'subtract', 'multiply-floor'] as const)
    return {
      id: `damage.generated.${caseIndex}.${index}`,
      stage: 'pre-type-modifiers',
      priority: generated.integer(-3, 3),
      source: {
        kind: generated.pick(['condition', 'encounter-effect', 'field'] as const),
        id: `source-${generated.integer(0, 3)}`,
      },
      stackingGroup: `group.${generated.integer(0, 3)}`,
      reasonCode: `damage.generated.${index}`,
      operation,
      value: operation === 'multiply-floor'
        ? generated.pick([0.5, 1, 1.5, 2] as const)
        : generated.integer(0, 8),
    }
  })

  return [{
    id: `damage.base.${caseIndex}`,
    stage: 'base-damage-base',
    priority: 0,
    source: { kind: 'move', id: `Property Move ${caseIndex}` },
    stackingGroup: 'base-damage',
    reasonCode: 'damage.base',
    operation: 'set',
    value: generated.integer(20, 60),
  }, {
    id: `damage.attack.${caseIndex}`,
    stage: 'attack-stat',
    priority: generated.integer(-3, 3),
    source: { kind: 'placement', id: 'actor-token' },
    stackingGroup: 'attack-stat',
    reasonCode: 'damage.attack',
    operation: 'add',
    value: generated.integer(1, 20),
  }, {
    id: `damage.defense.${caseIndex}`,
    stage: 'defense-stat',
    priority: generated.integer(-3, 3),
    source: { kind: 'placement', id: 'target-token' },
    stackingGroup: 'defense-stat',
    reasonCode: 'damage.defense',
    operation: 'subtract',
    value: generated.integer(0, 20),
  }, ...sameStage, {
    id: `damage.type.${caseIndex}`,
    stage: 'type-effectiveness',
    priority: 0,
    source: { kind: 'type', id: 'target-token' },
    stackingGroup: 'type-effectiveness',
    reasonCode: 'damage.type',
    operation: 'multiply-floor',
    value: generated.pick([0.5, 1, 1.5, 2] as const),
  }, {
    id: `damage.critical.${caseIndex}`,
    stage: 'critical-modifiers',
    priority: 0,
    source: { kind: 'move', id: `Property Move ${caseIndex}` },
    stackingGroup: 'critical-roll',
    reasonCode: 'damage.critical',
    operation: 'add-before-type',
    value: generated.integer(0, 12),
  }, {
    id: `damage.post.${caseIndex}`,
    stage: 'post-damage-modifiers',
    priority: 0,
    source: { kind: 'encounter-effect', id: 'effect.property' },
    stackingGroup: 'post-damage',
    reasonCode: 'damage.post',
    operation: 'subtract',
    value: generated.integer(0, 20),
  }, {
    id: `damage.minimum.${caseIndex}`,
    stage: 'minimum-damage',
    priority: 0,
    source: { kind: 'rules', id: 'rules.minimum' },
    stackingGroup: 'minimum-damage',
    reasonCode: 'damage.minimum',
    operation: 'floor-at-least',
    value: 1,
  }, {
    id: `damage.nonnegative.${caseIndex}`,
    stage: 'final-hp-loss',
    priority: 0,
    source: { kind: 'rules', id: 'rules.final' },
    stackingGroup: 'final-hp-loss',
    reasonCode: 'damage.nonnegative',
    operation: 'floor-at-least',
    value: 0,
  }, {
    id: `damage.floor.${caseIndex}`,
    stage: 'final-hp-loss',
    priority: 1,
    source: { kind: 'rules', id: 'rules.final' },
    stackingGroup: 'final-hp-loss',
    reasonCode: 'damage.floor',
    operation: 'floor',
  }]
}

describe('damage modifier ordering properties', () => {
  it('normalizes generated permutations by phase, priority, and stable tie-breakers', () => {
    const generated = createDeterministicPropertyGenerator(0x0880_7701)

    for (let caseIndex = 0; caseIndex < 96; caseIndex += 1) {
      const modifiers = generatedModifiers(generated, caseIndex)
      const expectedOrder = [...modifiers].sort(compareModifierOrder).map(modifier => modifier.id)
      const baseline = resolveMoveDamagePipeline({ damageBase: 1, modifiers })

      expect(baseline.stages.map(stage => stage.stage)).toEqual(MOVE_DAMAGE_PIPELINE_STAGES)
      expect(baseline.stages.flatMap(stage => stage.modifiers.map(modifier => modifier.id)))
        .toEqual(expectedOrder)
      expect(Number.isSafeInteger(baseline.hpLoss)).toBe(true)
      expect(baseline.hpLoss).toBeGreaterThanOrEqual(0)

      for (let permutation = 0; permutation < 8; permutation += 1) {
        const shuffled = resolveMoveDamagePipeline({
          damageBase: 1,
          modifiers: generated.shuffle(modifiers),
        })
        expect(shuffled, `modifier case ${caseIndex}, permutation ${permutation}`)
          .toEqual(baseline)
      }
    }
  })
})
