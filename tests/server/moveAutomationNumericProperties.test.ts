import { describe, expect, it } from 'vitest'
import { MOVE_RULE_AST_LIMITS } from '#shared/moveAutomation/ast'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseMoveExpression,
  type MoveExpression,
} from '#shared/moveAutomation/expressions'
import {
  MOVE_EXPRESSION_EVALUATION_LIMITS,
  evaluateMoveExpression,
} from '~~/server/domain/moveAutomation/evaluateExpression'
import {
  reduceCombatStageEffectForRecipient,
} from '~~/server/domain/moveAutomation/reducers/combatStage'
import {
  reduceDirectHpEffectForRecipient,
  reduceHealEffectForRecipient,
} from '~~/server/domain/moveAutomation/reducers/hp'
import {
  resolveMoveCoreTokenRecipient,
} from '~~/server/domain/moveAutomation/reducers/coreTokenRecipients'
import type {
  MoveCoreHpStateSnapshot,
  MoveCoreTokenEffectRecipient,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffectTypes'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import { COMBAT_STAGE_KEYS, clampCombatStage } from '~/utils/combatStages'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import { createMoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import {
  NEVER_PREVENT_CORE_TOKEN_EFFECTS,
  buildMechanicsPropertyContext,
  createDeterministicPropertyGenerator,
} from '../fixtures/moveAutomation/mechanicsProperties'

const numericValue = (value: unknown, label: string): number => {
  expect(typeof value, label).toBe('number')
  return value as number
}

const combatStageOperation = (
  stage: CombatStageKey,
  value: number,
): MoveCombatStageEffectOperation => {
  const operation = parseMoveEffectOperation({
    id: 'operation.property-stage',
    kind: 'combat-stage',
    source: { kind: 'move', id: 'move.property-test' },
    recipients: { kind: 'hit-targets' },
    phase: 'hit',
    reasonCode: 'move.property-test.stage',
    payload: {
      action: 'modify',
      stage,
      selectedStage: null,
      value,
      stageSource: null,
      rounding: null,
    },
  })
  if (operation.kind !== 'combat-stage') throw new Error('Expected a combat-stage operation.')
  return operation
}

const hpOperation = (
  kind: 'direct-hp' | 'heal',
  pool: 'hit-points' | 'temporary-hit-points',
  amount: number,
): MoveDirectHpEffectOperation | MoveHealEffectOperation => {
  const operation = parseMoveEffectOperation({
    id: `operation.property-${kind}-${pool}`,
    kind,
    source: { kind: 'move', id: 'move.property-test' },
    recipients: { kind: 'hit-targets' },
    phase: 'hit',
    reasonCode: `move.property-test.${kind}`,
    payload: kind === 'direct-hp'
      ? {
          mode: 'lose',
          pool,
          calculation: { kind: 'fixed', value: amount },
          copySource: null,
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          applyTypeImmunity: false,
          cost: null,
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        }
      : {
          mode: 'gain',
          pool,
          calculation: { kind: 'fixed', value: amount },
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
  })
  if (operation.kind !== kind) throw new Error(`Expected a ${kind} operation.`)
  return operation
}

const recipientWith = (
  recipient: MoveCoreTokenEffectRecipient,
  options: {
    readonly currentHp?: number
    readonly temporaryHp?: number
    readonly combatStages?: CombatStageMap
  },
): MoveCoreTokenEffectRecipient => ({
  ...recipient,
  token: {
    ...recipient.token,
    ...(options.currentHp === undefined ? {} : { currentHp: options.currentHp }),
    ...(options.temporaryHp === undefined ? {} : { temporaryHp: options.temporaryHp }),
    ...(options.combatStages === undefined ? {} : { combatStages: options.combatStages }),
  },
})

const hpState = (
  result: { readonly current: unknown },
): MoveCoreHpStateSnapshot => {
  const current = result.current as MoveCoreHpStateSnapshot
  expect(current.kind).toBe('hp')
  return current
}

describe('bounded expression properties', () => {
  it('keeps generated arithmetic and clamp trees finite, bounded, and deterministic', () => {
    const context = buildMechanicsPropertyContext()
    const generated = createDeterministicPropertyGenerator(0x0880_7401)

    for (let caseIndex = 0; caseIndex < 256; caseIndex += 1) {
      const left = generated.integer(-10_000, 10_000)
      const right = generated.integer(-10_000, 10_000)
      const offset = generated.integer(-1_000_000, 1_000_000)
      const firstBound = generated.integer(-100_000_000, 100_000_000)
      const secondBound = generated.integer(-100_000_000, 100_000_000)
      const minimum = Math.min(firstBound, secondBound)
      const maximum = Math.max(firstBound, secondBound)
      const raw = left * right + offset
      const expected = Math.min(maximum, Math.max(minimum, raw))
      const expression = parseMoveExpression({
        kind: 'clamp',
        value: {
          kind: 'arithmetic',
          operator: 'add',
          operands: [{
            kind: 'arithmetic',
            operator: 'multiply',
            operands: [
              { kind: 'constant', value: left },
              { kind: 'constant', value: right },
            ],
          }, {
            kind: 'constant',
            value: offset,
          }],
        },
        minimum: { kind: 'constant', value: minimum },
        maximum: { kind: 'constant', value: maximum },
      })

      const first = evaluateMoveExpression({ expression, context })
      const second = evaluateMoveExpression({ expression, context })

      expect(first, `expression case ${caseIndex}`).toEqual(second)
      expect(first.value, `expression case ${caseIndex}`).toBe(expected)
      expect(first.trace.length).toBeLessThanOrEqual(MOVE_EXPRESSION_EVALUATION_LIMITS.nodes)
      for (const entry of first.trace) {
        const value = numericValue(entry.value, `expression trace case ${caseIndex}`)
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThanOrEqual(
          MOVE_EXPRESSION_EVALUATION_LIMITS.numericMagnitude,
        )
      }
    }
  })

  it('rejects generated values outside the numeric magnitude boundary', () => {
    const context = buildMechanicsPropertyContext()
    const generated = createDeterministicPropertyGenerator(0x0880_7402)

    for (let caseIndex = 0; caseIndex < 64; caseIndex += 1) {
      const sign = generated.pick([-1, 1] as const)
      const overshoot = generated.integer(1, 1_000_000)
      const expression = {
        kind: 'constant',
        value: sign * (MOVE_RULE_AST_LIMITS.numericMagnitude + overshoot),
      } as MoveExpression

      expect(
        () => evaluateMoveExpression({ expression, context }),
        `overflow case ${caseIndex}`,
      ).toThrowError(expect.objectContaining({ code: 'numeric-overflow' }))
    }
  })
})

describe('combat-stage cap properties', () => {
  it('clamps every generated stage delta to the canonical range without changing peers', () => {
    const context = buildMechanicsPropertyContext()
    const baseRecipient = resolveMoveCoreTokenRecipient(context, 'target-a-token')
    const generated = createDeterministicPropertyGenerator(0x0880_8301)

    for (let caseIndex = 0; caseIndex < 256; caseIndex += 1) {
      const stage = generated.pick(COMBAT_STAGE_KEYS)
      const current = generated.integer(-6, 6)
      const delta = generated.integer(-6, 6)
      const initial = Object.fromEntries(
        COMBAT_STAGE_KEYS.map(key => [key, key === stage ? current : generated.integer(-6, 6)]),
      ) as unknown as CombatStageMap
      const recipient = recipientWith(baseRecipient, { combatStages: initial })
      const result = reduceCombatStageEffectForRecipient({
        operation: combatStageOperation(stage, delta),
        recipient,
        accumulator: createMoveAutomationCombatStageUpdateAccumulator(),
        immunities: NEVER_PREVENT_CORE_TOKEN_EFFECTS,
      })
      if (result.current.kind !== 'combat-stages') throw new Error('Expected combat-stage state.')

      const expected = clampCombatStage(current + delta)
      expect(result.current.stages[stage], `stage case ${caseIndex}`).toBe(expected)
      for (const key of COMBAT_STAGE_KEYS) {
        expect(result.current.stages[key]).toBeGreaterThanOrEqual(-6)
        expect(result.current.stages[key]).toBeLessThanOrEqual(6)
        if (key !== stage) expect(result.current.stages[key]).toBe(initial[key])
      }
      expect(result.outcome).toBe(expected === current ? 'no-op' : 'applied')
    }
  })
})

describe('HP reducer properties', () => {
  it('preserves directional and pool bounds over generated healing and direct loss', () => {
    const context = buildMechanicsPropertyContext()
    const baseRecipient = resolveMoveCoreTokenRecipient(context, 'target-a-token')
    const maximumHp = baseRecipient.token.maxHp
    const generated = createDeterministicPropertyGenerator(0x0880_8001)

    for (let caseIndex = 0; caseIndex < 192; caseIndex += 1) {
      const currentHp = generated.integer(0, maximumHp)
      const temporaryHp = generated.integer(0, maximumHp)
      const amount = generated.integer(0, maximumHp * 2)
      const recipient = recipientWith(baseRecipient, { currentHp, temporaryHp })

      const heal = hpOperation('heal', 'hit-points', amount)
      if (heal.kind !== 'heal') throw new Error('Expected heal operation.')
      const healed = hpState(reduceHealEffectForRecipient({
        operation: heal,
        recipient,
        accumulator: createMoveAutomationHpUpdateAccumulator(),
        temporaryHpAvailable: true,
        context,
        priorOperationResults: [],
      }))
      expect(healed.currentHp, `healing case ${caseIndex}`).toBe(
        Math.min(maximumHp, currentHp + amount),
      )
      expect(healed.currentHp).toBeGreaterThanOrEqual(currentHp)
      expect(healed.currentHp).toBeLessThanOrEqual(healed.maxHp)
      expect(healed.temporaryHp).toBe(temporaryHp)

      const loss = hpOperation('direct-hp', 'hit-points', amount)
      if (loss.kind !== 'direct-hp') throw new Error('Expected direct HP operation.')
      const lost = hpState(reduceDirectHpEffectForRecipient({
        operation: loss,
        recipient,
        accumulator: createMoveAutomationHpUpdateAccumulator(),
        temporaryHpAvailable: true,
        immunities: NEVER_PREVENT_CORE_TOKEN_EFFECTS,
        context,
        hitTargetIds: [recipient.placement.id],
        priorOperationResults: [],
      }))
      expect(lost.currentHp, `loss case ${caseIndex}`).toBe(currentHp - amount)
      expect(lost.currentHp).toBeLessThanOrEqual(currentHp)
      expect(lost.currentHp).toBeLessThanOrEqual(lost.maxHp)
      expect(lost.temporaryHp).toBe(temporaryHp)

      const temporaryHeal = hpOperation('heal', 'temporary-hit-points', amount)
      if (temporaryHeal.kind !== 'heal') throw new Error('Expected temporary HP heal operation.')
      const temporary = hpState(reduceHealEffectForRecipient({
        operation: temporaryHeal,
        recipient,
        accumulator: createMoveAutomationHpUpdateAccumulator(),
        temporaryHpAvailable: true,
        context,
        priorOperationResults: [],
      }))
      expect(temporary.currentHp).toBe(currentHp)
      expect(temporary.temporaryHp, `temporary HP case ${caseIndex}`).toBe(
        temporaryHp + amount,
      )
      expect(Number.isSafeInteger(temporary.temporaryHp)).toBe(true)
      expect(temporary.temporaryHp).toBeGreaterThanOrEqual(0)
    }
  })
})
