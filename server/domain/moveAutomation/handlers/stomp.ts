import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import {
  createAccuracyTriggeredConditionOperation,
  createStandardMoveDamageOperation,
} from '../standardDamageOperations'
import { moveAutomationSizeCategoryDifference } from '../targetState'
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from './registry'

export const STOMP_HANDLER_ID = 'ma204.stomp-relative-size' as const
export const STOMP_SMALLER_TARGET_DAMAGE_BONUS = 10 as const

const stompOperations = (
  appliesSmallerTargetBonus: boolean,
): readonly MoveEffectOperation[] => [
  createStandardMoveDamageOperation({
    slug: 'stomp',
    damageBase: 7,
    damageClass: 'physical',
    moveType: 'normal',
    source: { kind: 'move', id: 'move.stomp' },
    ...(appliesSmallerTargetBonus
      ? {
          preTypeDamageModifiers: [{
            id: 'damage.stomp.smaller-target-bonus',
            priority: 210,
            stackingGroup: 'stomp.smaller-target-bonus',
            reasonCode: 'stomp.smaller-target-additional-damage',
            value: STOMP_SMALLER_TARGET_DAMAGE_BONUS,
          }],
        }
      : {}),
  }),
  createAccuracyTriggeredConditionOperation({
    slug: 'stomp',
    id: 'flinch',
    conditionId: 'flinch',
    trigger: { kind: 'range', minimum: 15 },
  }),
]

/**
 * Stomp's relative-size clause uses only effective server-projected size
 * categories. Missing size data fails closed for the bonus without making the
 * otherwise legal attack unavailable.
 */
const runStompHandler = (context: RegisteredMoveHandlerContext) => {
  const actorState = context.queries.targetStates.resolve(context.actor.placement.id)
  const targetPlacementId = context.selectedPlacements[0]?.id ?? null
  const targetState = targetPlacementId
    ? context.queries.targetStates.resolve(targetPlacementId)
    : null
  const categoryDifference = moveAutomationSizeCategoryDifference(
    actorState?.size ?? null,
    targetState?.size ?? null,
  )
  const appliesSmallerTargetBonus = categoryDifference !== null && categoryDifference >= 1
  const reasonCode = categoryDifference === null
    ? 'stomp.size-unavailable'
    : appliesSmallerTargetBonus
      ? 'stomp.target-at-least-one-size-smaller'
      : 'stomp.target-not-smaller'

  return {
    operations: stompOperations(appliesSmallerTargetBonus),
    traceEntries: [{
      kind: 'predicate' as const,
      phase: 'damage' as const,
      predicateId: 'stomp.smaller-target-damage',
      outcome: appliesSmallerTargetBonus,
      reasonCode,
      input: {
        actorSize: actorState?.size ?? null,
        targetSize: targetState?.size ?? null,
        categoryDifference,
        requiredDifference: 1,
      },
    }],
  }
}

export const STOMP_MOVE_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration = Object.freeze({
  id: STOMP_HANDLER_ID,
  version: 1,
  run: runStompHandler,
})
