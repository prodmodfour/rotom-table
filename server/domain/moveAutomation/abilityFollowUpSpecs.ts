import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveLogEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type { PendingMoveResponseWindow } from '#shared/moveAutomation/pendingResolution'
import { stableJsonStringify } from './stableJson'

/**
 * The historical module path is retained because the frozen Ability migration
 * baseline names it. Production Ability follow-ups are retired; the only new
 * continuation authored here is the trigger form of the canonical Move Spite.
 */
export const SPITE_FOLLOW_UP_PROGRAM_VERSION = 2 as const

export interface SpiteFollowUpResponseSpec {
  readonly kind: 'spite'
  readonly displayName: 'Spite'
  readonly reasonCode: 'move.spite.follow-up'
  readonly promptKey: 'move.spite.disable-provoking-move'
  readonly optionId: 'move.spite.apply'
  readonly optionLabelKey: 'move.spite.disable-move'
  readonly priority: 100
}

export const SPITE_FOLLOW_UP_RESPONSE_SPEC: SpiteFollowUpResponseSpec = Object.freeze({
  kind: 'spite',
  displayName: 'Spite',
  reasonCode: 'move.spite.follow-up',
  promptKey: 'move.spite.disable-provoking-move',
  optionId: 'move.spite.apply',
  optionLabelKey: 'move.spite.disable-move',
  priority: 100,
})

export const SPITE_FOLLOW_UP_DEFINITION_HASH = createHash('sha256')
  .update(stableJsonStringify({
    version: SPITE_FOLLOW_UP_PROGRAM_VERSION,
    spec: SPITE_FOLLOW_UP_RESPONSE_SPEC,
  }))
  .digest('hex')

export const spiteFollowUpSpecForWindow = (
  window: PendingMoveResponseWindow,
): SpiteFollowUpResponseSpec | null => window.reasonCode === SPITE_FOLLOW_UP_RESPONSE_SPEC.reasonCode
  ? SPITE_FOLLOW_UP_RESPONSE_SPEC
  : null

const conditionOperation = (input: {
  readonly window: PendingMoveResponseWindow
  readonly canonicalMoveId: string
}): MoveConditionEffectOperation => ({
  id: `${input.window.operationId}.effect`,
  kind: 'condition',
  source: { kind: 'operation', id: input.window.operationId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: `${input.window.reasonCode}.applied`,
  payload: {
    action: 'apply',
    conditionId: 'disabled',
    conditionDetail: input.canonicalMoveId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const logOperation = (input: {
  readonly window: PendingMoveResponseWindow
  readonly canonicalMoveId: string
}): MoveLogEffectOperation => ({
  id: `${input.window.operationId}.log`,
  kind: 'log',
  source: { kind: 'operation', id: input.window.operationId },
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: `${input.window.reasonCode}.logged`,
  payload: {
    messageKey: SPITE_FOLLOW_UP_RESPONSE_SPEC.promptKey,
    arguments: [
      { key: 'move', value: SPITE_FOLLOW_UP_RESPONSE_SPEC.displayName },
      { key: 'triggering-move', value: input.canonicalMoveId },
    ],
  },
})

/** Build only the strictly reviewed Spite response operations. */
export const buildSpiteFollowUpEffectOperations = (input: {
  readonly window: PendingMoveResponseWindow
  readonly optionId: string
  readonly canonicalMoveId: string
}): readonly MoveEffectOperation[] => {
  const spec = spiteFollowUpSpecForWindow(input.window)
  if (!spec || input.optionId !== spec.optionId) {
    throw new Error('The durable post-Move option has no reviewed Spite definition.')
  }
  return Object.freeze([
    parseMoveEffectOperation(conditionOperation(input), 'spiteFollowUp.effect'),
    parseMoveEffectOperation(logOperation(input), 'spiteFollowUp.log'),
  ])
}
