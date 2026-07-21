import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveDamageEffectOperation,
  type MoveEffectDamageBaseStabTiming,
  type MoveEffectRoundingPolicy,
} from '#shared/moveAutomation/effects'
import type {
  MoveRuleEvaluationTraceEntry,
  MoveRuleSelectorState,
} from './evaluateExpression'
import { evaluateMoveExpression } from './evaluateExpression'
import type { AuthoritativeMoveRulesContext } from './context'

/** Canonical PTU same-type attack bonus applied to a move's Damage Base. */
export const MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS = 2 as const

export type MoveContextualDamageBaseResolutionErrorCode =
  | 'contextual-damage-base-required'
  | 'non-numeric-damage-base'
  | 'resolved-damage-base-out-of-range'

export class MoveContextualDamageBaseResolutionError extends Error {
  readonly code: MoveContextualDamageBaseResolutionErrorCode
  readonly operationId: string
  readonly recipientId: string

  constructor(
    code: MoveContextualDamageBaseResolutionErrorCode,
    operationId: string,
    recipientId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveContextualDamageBaseResolutionError'
    this.code = code
    this.operationId = operationId
    this.recipientId = recipientId
  }
}

export interface MoveContextualDamageBaseResolution {
  readonly operationId: string
  readonly recipientId: string
  readonly expressionValue: number
  readonly rounding: MoveEffectRoundingPolicy
  readonly roundedExpressionValue: number
  readonly stabTiming: MoveEffectDamageBaseStabTiming
  readonly stabBonus: number
  /** Rounded expression plus STAB only when STAB is configured before bounds. */
  readonly valueBeforeBounds: number
  readonly minimum: number
  readonly maximum: number
  readonly boundedValue: number
  /** Reviewed Ability/provider bonus applied after the move's own expression, STAB, and bounds. */
  readonly postBoundsBonus: number
  readonly finalDamageBase: number
  /** Post-order values for every evaluated expression node. */
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

const selectorStateFor = (recipientId: string): MoveRuleSelectorState => ({
  targetIds: [recipientId],
  hitTargetIds: [recipientId],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const rounded = (value: number, policy: MoveEffectRoundingPolicy): number => {
  if (policy === 'ceil') return Math.ceil(value)
  if (policy === 'round') return Math.round(value)
  return Math.floor(value)
}

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const fail = (
  code: MoveContextualDamageBaseResolutionErrorCode,
  operation: MoveDamageEffectOperation,
  recipientId: string,
  message: string,
): never => {
  throw new MoveContextualDamageBaseResolutionError(
    code,
    operation.id,
    recipientId,
    message,
  )
}

/**
 * Resolve one native-v2 contextual Damage Base for exactly one authoritative
 * recipient. The expression is evaluated before root rounding, STAB, and
 * inclusive min/max bounds so every ordering step remains explicit in audit
 * evidence.
 */
export const resolveContextualMoveDamageBase = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly hasStab: boolean
  readonly canonicalMoveId?: string
  readonly postBoundsBonus?: number
}): MoveContextualDamageBaseResolution => {
  const { operation, recipientId } = options
  const damageBase = operation.payload.damageBase
  if (typeof damageBase === 'number') {
    return fail(
      'contextual-damage-base-required',
      operation,
      recipientId,
      `Damage operation ${operation.id} has a fixed Damage Base.`,
    )
  }

  const evaluation = evaluateMoveExpression({
    expression: damageBase.expression,
    context: options.context,
    selectorState: selectorStateFor(recipientId),
    canonicalMoveId: options.canonicalMoveId,
    rootNodeId: `${operation.id}.damageBase.${recipientId}`,
  })
  if (typeof evaluation.value !== 'number' || !Number.isFinite(evaluation.value)) {
    return fail(
      'non-numeric-damage-base',
      operation,
      recipientId,
      `Damage operation ${operation.id} did not resolve a numeric Damage Base for ${recipientId}.`,
    )
  }

  const roundedExpressionValue = rounded(evaluation.value, damageBase.rounding)
  const stabBonus = options.hasStab && damageBase.stabTiming !== 'none'
    ? MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS
    : 0
  const valueBeforeBounds = roundedExpressionValue + (
    damageBase.stabTiming === 'before-bounds' ? stabBonus : 0
  )
  const boundedValue = clamp(
    valueBeforeBounds,
    damageBase.minimum,
    damageBase.maximum,
  )
  const postBoundsBonus = options.postBoundsBonus ?? 0
  const finalDamageBase = boundedValue + (
    damageBase.stabTiming === 'after-bounds' ? stabBonus : 0
  ) + postBoundsBonus
  if (
    !Number.isSafeInteger(finalDamageBase)
    || finalDamageBase < 0
    || finalDamageBase > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return fail(
      'resolved-damage-base-out-of-range',
      operation,
      recipientId,
      `Damage operation ${operation.id} resolved out-of-range DB ${finalDamageBase} for ${recipientId}.`,
    )
  }

  return deepFreeze({
    operationId: operation.id,
    recipientId,
    expressionValue: evaluation.value,
    rounding: damageBase.rounding,
    roundedExpressionValue,
    stabTiming: damageBase.stabTiming,
    stabBonus,
    valueBeforeBounds,
    minimum: damageBase.minimum,
    maximum: damageBase.maximum,
    boundedValue,
    postBoundsBonus,
    finalDamageBase,
    evaluationTrace: [...evaluation.trace],
  })
}
