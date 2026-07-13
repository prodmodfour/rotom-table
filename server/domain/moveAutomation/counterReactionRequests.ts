import {
  parseMoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import { moveReactionTimingDefinition } from '#shared/moveAutomation/reactions'
import {
  moveCounterReactionDefinition,
  type MoveCounterReactionCanonicalId,
} from './counterReactionDefinitions'
import { assertCounterStableId } from './counterReactionCore'

/** Build a durable phase-bound response request for a future registered spec. */
export const buildMoveCounterReactionRequestOperation = (input: {
  readonly canonicalMoveId: MoveCounterReactionCanonicalId
  readonly operationId: string
  readonly recipients: MoveEffectRecipientSelectorKind
}): MoveReactionRequestEffectOperation => {
  const definition = moveCounterReactionDefinition(input.canonicalMoveId)
  const operationId = assertCounterStableId(
    input.operationId,
    'reaction request operation ID',
  )
  const operation: MoveReactionRequestEffectOperation = {
    id: operationId,
    kind: 'reaction-request',
    source: { kind: 'move', id: `move.${definition.definitionId}` },
    recipients: { kind: input.recipients },
    phase: moveReactionTimingDefinition(definition.triggerTiming).phase,
    reasonCode: `${definition.definitionId}.reaction-window`,
    payload: {
      requestId: `${definition.definitionId}.reaction-request`,
      promptKey: definition.promptKey,
      options: [{ id: definition.optionId, labelKey: definition.optionLabelKey }],
      allowPass: true,
      timing: definition.triggerTiming,
      priority: definition.priority,
    },
  }
  return parseMoveEffectOperation(
    operation,
    'counterReaction.request',
  ) as MoveReactionRequestEffectOperation
}
