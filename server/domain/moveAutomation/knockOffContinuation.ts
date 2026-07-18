import type { MoveChoiceRequestEffectOperation } from '#shared/moveAutomation/effects'
import type { AuthoritativeMoveRulesContext } from './context'
import {
  KNOCK_OFF_ITEM_CHOICE_OPERATION,
  KNOCK_OFF_ITEM_REQUEST_ID,
  KnockOffItemOutcomeError,
  planKnockOffItemOutcome,
  type KnockOffItemOutcome,
} from './knockOff'

export type KnockOffContinuationErrorCode =
  | 'invalid-damage-recipient'
  | 'item-outcome-unavailable'

export class KnockOffContinuationError extends Error {
  readonly code: KnockOffContinuationErrorCode

  constructor(code: KnockOffContinuationErrorCode, message: string) {
    super(message)
    this.name = 'KnockOffContinuationError'
    this.code = code
  }
}

export interface KnockOffContinuationRollReference {
  readonly purpose: string
  readonly recipientId: string | null
  readonly rollId: string
}

/** Identify only the reviewed Knock Off choice operation, never a client-selected runtime shape. */
export const isKnockOffItemChoiceOperation = (
  canonicalMoveId: string,
  operation: MoveChoiceRequestEffectOperation,
): boolean => canonicalMoveId === 'Knock Off'
  && operation.id === KNOCK_OFF_ITEM_CHOICE_OPERATION.id
  && operation.payload.requestId === KNOCK_OFF_ITEM_REQUEST_ID

const criticalHitProjection = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly resolvedRolls: readonly KnockOffContinuationRollReference[]
  readonly recipientId: string
}): boolean => {
  const accuracy = input.resolvedRolls.find(roll => (
    roll.purpose === 'accuracy' && roll.recipientId === input.recipientId
  ))
  if (!accuracy) return false
  return input.context.random.snapshot().find(entry => entry.rollId === accuracy.rollId)
    ?.naturalResult === 20
}

/**
 * Bridge interpreter hit evidence into the pure MA-176A item-outcome seam.
 * The positive damage value is a non-committing projection: PTU damage that
 * reached this recipient has already passed authoritative type immunity. The
 * core reducer supplies exact effective HP loss again before a terminal plan.
 */
export const planProjectedKnockOffItemContinuation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly resolvedRolls: readonly KnockOffContinuationRollReference[]
  readonly recipientIds: readonly string[]
  readonly selectedOptionId?: string | null
}): KnockOffItemOutcome => {
  if (input.recipientIds.length !== 1) {
    throw new KnockOffContinuationError(
      'invalid-damage-recipient',
      'Knock Off requires exactly one authoritative damaging recipient.',
    )
  }
  const targetPlacementId = input.recipientIds[0]!
  try {
    return planKnockOffItemOutcome({
      context: input.context,
      combat: {
        kind: 'hit',
        targetPlacementId,
        damageDealt: 1,
        criticalHit: criticalHitProjection({
          context: input.context,
          resolvedRolls: input.resolvedRolls,
          recipientId: targetPlacementId,
        }),
      },
      ...(input.selectedOptionId === undefined
        ? {}
        : { selectedOptionId: input.selectedOptionId }),
    })
  }
  catch (error) {
    if (error instanceof KnockOffItemOutcomeError) {
      throw new KnockOffContinuationError(
        'item-outcome-unavailable',
        `Knock Off item outcome could not be resolved: ${error.message}`,
      )
    }
    throw error
  }
}
