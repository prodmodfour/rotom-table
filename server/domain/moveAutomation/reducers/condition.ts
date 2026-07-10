import type { MoveConditionEffectOperation } from '#shared/moveAutomation/effects'
import {
  addAppliedCondition,
  removeAppliedCondition,
} from '~/utils/conditionApplication'
import type { MoveAutomationConditionUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import {
  normalizeConditionName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { sameJsonValue } from '~/utils/serialization'
import type {
  MoveCoreConditionStateSnapshot,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

export class MoveCoreConditionReductionError extends Error {
  readonly code = 'unknown-condition'

  constructor(conditionId: string) {
    super(`Condition effect references unknown canonical condition ${conditionId}.`)
    this.name = 'MoveCoreConditionReductionError'
  }
}

const conditionSnapshot = (
  accumulator: MoveAutomationConditionUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreConditionStateSnapshot => ({
  kind: 'conditions',
  conditions: normalizeConditionNames(accumulator.get(recipient.token)),
})

export const reduceConditionEffectForRecipient = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationConditionUpdateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = conditionSnapshot(accumulator, recipient)
  const condition = operation.payload.conditionId === null
    ? null
    : normalizeConditionName(operation.payload.conditionId)
  if (operation.payload.conditionId !== null && !condition) {
    throw new MoveCoreConditionReductionError(operation.payload.conditionId)
  }

  const immunity = operation.payload.action === 'apply'
    ? options.immunities.condition({
        operation,
        condition: condition!,
        recipient,
      })
    : { blockedBy: null, consultedPlacementIds: [] }
  if (immunity.blockedBy) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'prevented',
      reasonCode: 'condition-immunity',
      blockers: [{ subject: condition, source: immunity.blockedBy }],
      consultedPlacementIds: immunity.consultedPlacementIds,
      previous,
      current: previous,
      changedFields: [],
    }
  }

  const nextConditions = operation.payload.action === 'clear'
    ? []
    : operation.payload.action === 'remove'
      ? removeAppliedCondition(previous.conditions, condition)
      : addAppliedCondition(previous.conditions, condition)
  accumulator.set(recipient.token, nextConditions)
  const current = conditionSnapshot(accumulator, recipient)

  if (sameJsonValue(previous.conditions, current.conditions)) {
    const reasonCode = operation.payload.action === 'apply'
      ? 'condition-already-applied'
      : operation.payload.action === 'remove'
        ? 'condition-absent'
        : 'conditions-empty'
    return {
      recipientId: recipient.placement.id,
      outcome: 'no-op',
      reasonCode,
      blockers: [],
      consultedPlacementIds: immunity.consultedPlacementIds,
      previous,
      current,
      changedFields: [],
    }
  }

  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    consultedPlacementIds: immunity.consultedPlacementIds,
    previous,
    current,
    changedFields: ['conditions'],
  }
}
