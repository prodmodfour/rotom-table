import {
  parseMoveEffectOperation,
  type MovePermanentMoveListEffectOperation,
} from '#shared/moveAutomation/effects'
import { findMove } from '~~/data/ptuReference'
import type { RegisteredMoveHandlerContext } from './handlers/registry'

export type SketchMoveListReplacementErrorCode =
  | 'target-count-invalid'
  | 'target-history-missing'
  | 'target-history-move-invalid'
  | 'replacement-is-sketch'

export class SketchMoveListReplacementError extends Error {
  readonly code: SketchMoveListReplacementErrorCode

  constructor(code: SketchMoveListReplacementErrorCode, message: string) {
    super(message)
    this.name = 'SketchMoveListReplacementError'
    this.code = code
  }
}

const fail = (
  code: SketchMoveListReplacementErrorCode,
  message: string,
): never => {
  throw new SketchMoveListReplacementError(code, message)
}

/**
 * Build Sketch's server-authored replacement from the selected target's latest
 * completed structured move-use record. The resulting operation still passes
 * the permanent-list reducer's fresh history, slot, duplicate, and CAS checks.
 */
export const createSketchMoveListReplacementOperation = (
  context: RegisteredMoveHandlerContext,
): MovePermanentMoveListEffectOperation => {
  if (context.selectedPlacements.length !== 1) {
    return fail(
      'target-count-invalid',
      'Sketch requires exactly one authoritative selected target.',
    )
  }
  const target = context.selectedPlacements[0]!
  const lastMove = context.queries.history.lastCompletedMove(target.id)
    ?? fail(
      'target-history-missing',
      `Sketch target ${target.id} has no retained completed move.`,
    )
  const learned = findMove(lastMove.canonicalId)
    ?? fail(
      'target-history-move-invalid',
      `Sketch target history move ${lastMove.canonicalId} is not canonical.`,
    )
  if (learned.name === 'Sketch') {
    return fail(
      'replacement-is-sketch',
      'Sketch cannot replace itself with the same move.',
    )
  }

  return parseMoveEffectOperation({
    id: 'sketch.replace-self',
    kind: 'permanent-move-list',
    source: { kind: 'move', id: 'move.sketch' },
    recipients: { kind: 'actor' },
    phase: 'hit',
    reasonCode: 'sketch.replace-with-target-history',
    payload: {
      action: 'replace',
      replacedMoveId: 'Sketch',
      moveId: learned.name,
      acquisition: {
        kind: 'encounter-history',
        sourcePlacementId: target.id,
        sourceResolutionId: lastMove.resolutionId,
      },
    },
  }) as MovePermanentMoveListEffectOperation
}
