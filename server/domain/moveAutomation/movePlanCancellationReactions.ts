import {
  parseMoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import { moveReactionTimingDefinition } from '#shared/moveAutomation/reactions'
import {
  assertMovePlanPlacement,
  assertMovePlanStableId,
  cancelInterruptibleMovePlan,
  createMovePlanUsageSpend,
  type InterruptibleMovePlan,
  type InterruptibleMovePlanAuthority,
  type MovePlanCancellationApplication,
} from './interruptibleMovePlan'
import {
  moveSetupReactionDefinition,
  type MovePlanCancellationReactionDefinition,
} from './setupReactionDefinitions'

export type ApplyReviewedMovePlanCancellationResult =
  | {
      readonly status: 'cancelled' | 'duplicate'
      readonly reasonCode: string
      readonly plan: InterruptibleMovePlan
      readonly application: MovePlanCancellationApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode:
        | 'cancellation-keyword-mismatch'
        | 'feint-not-triggering-action-source'
        | 'drown-out-reactor-not-enemy'
      readonly plan: InterruptibleMovePlan
      readonly application: null
    }

const ineligible = (
  plan: InterruptibleMovePlan,
  reasonCode: Extract<ApplyReviewedMovePlanCancellationResult, {
    status: 'ineligible'
  }>['reasonCode'],
): ApplyReviewedMovePlanCancellationResult => Object.freeze({
  status: 'ineligible',
  reasonCode,
  plan,
  application: null,
})

/**
 * Cancel one shield or Sonic plan before persistence. Triggering frequency is
 * retained by reviewed policy; only the deferred mechanics list is removed.
 */
export const applyReviewedMovePlanCancellation = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly plan: InterruptibleMovePlan
  readonly canonicalReactionId: MovePlanCancellationReactionDefinition['canonicalId']
  readonly reactorPlacementId: string
  readonly reactionOperationId: string
}): ApplyReviewedMovePlanCancellationResult => {
  const definition = moveSetupReactionDefinition(input.canonicalReactionId)
  if (definition.family !== 'plan-cancellation') {
    throw new Error(`${input.canonicalReactionId} is not a plan-cancellation definition.`)
  }
  const reactorPlacementId = assertMovePlanPlacement(
    input.authority,
    input.reactorPlacementId,
    'Plan-cancellation reactor',
  )
  const reactionOperationId = assertMovePlanStableId(
    input.reactionOperationId,
    'Plan-cancellation reaction operation ID',
  )
  if (!input.plan.keywords.includes(definition.triggeringKeyword)) {
    return ineligible(input.plan, 'cancellation-keyword-mismatch')
  }
  if (
    definition.canonicalId === 'Feint'
    && input.plan.triggeringActionSourcePlacementId !== reactorPlacementId
  ) {
    return ineligible(input.plan, 'feint-not-triggering-action-source')
  }
  if (
    definition.canonicalId === 'Drown Out'
    && input.authority.relationships.resolve(
      reactorPlacementId,
      input.plan.actorPlacementId,
    ).relationship !== 'enemy'
  ) {
    return ineligible(input.plan, 'drown-out-reactor-not-enemy')
  }

  const cancellation = cancelInterruptibleMovePlan({
    authority: input.authority,
    plan: input.plan,
    applicationId: reactionOperationId,
    cancellationKind: definition.definitionId,
    reasonCode: `${definition.definitionId}.triggering-plan-cancelled`,
    canceller: { kind: 'placement', id: reactorPlacementId },
    retainTriggeringUsage: definition.retainTriggeringUsage,
    reactionUsage: createMovePlanUsageSpend(input.authority, {
      operationId: `${reactionOperationId}.usage`,
      ownerPlacementId: reactorPlacementId,
      resourceId: definition.usageResourceId,
      disposition: 'reaction',
    }),
  })
  return Object.freeze({
    status: cancellation.status,
    reasonCode: cancellation.application.reasonCode,
    plan: cancellation.plan,
    application: cancellation.application,
  })
}

/** Build the durable ID-only response window for Feint or Drown Out. */
export const buildMovePlanCancellationRequestOperation = (input: {
  readonly canonicalReactionId: MovePlanCancellationReactionDefinition['canonicalId']
  readonly operationId: string
  readonly recipients: MoveEffectRecipientSelectorKind
}): MoveReactionRequestEffectOperation => {
  const definition = moveSetupReactionDefinition(input.canonicalReactionId)
  if (definition.family !== 'plan-cancellation') {
    throw new Error(`${input.canonicalReactionId} is not a plan-cancellation definition.`)
  }
  const operation: MoveReactionRequestEffectOperation = {
    id: assertMovePlanStableId(input.operationId, 'Cancellation request operation ID'),
    kind: 'reaction-request',
    source: {
      kind: definition.sourceKind === 'ability' ? 'operation' : 'move',
      id: `${definition.sourceKind}.${definition.definitionId}`,
    },
    recipients: { kind: input.recipients },
    phase: moveReactionTimingDefinition(definition.timing).phase,
    reasonCode: `${definition.definitionId}.cancellation-window`,
    payload: {
      requestId: `${definition.definitionId}.cancellation-request`,
      promptKey: definition.promptKey,
      options: [{ id: definition.optionId, labelKey: definition.optionLabelKey }],
      allowPass: true,
      timing: definition.timing,
      priority: definition.priority,
    },
  }
  return parseMoveEffectOperation(
    operation,
    'setupReaction.cancellationRequest',
  ) as MoveReactionRequestEffectOperation
}
