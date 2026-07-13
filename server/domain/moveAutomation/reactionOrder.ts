import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import {
  compareMoveReactionOrder,
  moveReactionTimingDefinition,
} from '#shared/moveAutomation/reactions'

export interface OrderedMoveEffectOperationEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

const operationPosition = (
  operation: MoveEffectOperation,
): 'before' | 'ordinary' | 'after' => {
  if (operation.kind !== 'reaction-request') return 'ordinary'
  return moveReactionTimingDefinition(operation.payload.timing).operationPosition
    === 'before-phase-operations'
    ? 'before'
    : 'after'
}

const positionRank = (position: ReturnType<typeof operationPosition>): number => {
  if (position === 'before') return 0
  if (position === 'ordinary') return 1
  return 2
}

/**
 * Place reaction checkpoints around ordinary phase operations, then execute
 * simultaneous windows by descending priority and stable reviewed operation
 * identity. Ordinary operation order remains behavior-significant and intact.
 */
export const orderMoveReactionOperationEntries = <
  Entry extends OrderedMoveEffectOperationEntry,
>(entries: readonly Entry[]): readonly Entry[] => {
  const sourceIndex = new Map(entries.map((entry, index) => [entry, index]))
  return [...entries].sort((left, right) => {
    const leftPosition = operationPosition(left.operation)
    const rightPosition = operationPosition(right.operation)
    const rank = positionRank(leftPosition) - positionRank(rightPosition)
    if (rank !== 0) return rank
    if (
      left.operation.kind === 'reaction-request'
      && right.operation.kind === 'reaction-request'
    ) {
      return compareMoveReactionOrder({
        operationId: left.operation.id,
        timing: left.operation.payload.timing,
        priority: left.operation.payload.priority,
      }, {
        operationId: right.operation.id,
        timing: right.operation.payload.timing,
        priority: right.operation.payload.priority,
      })
    }
    return (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0)
  })
}
