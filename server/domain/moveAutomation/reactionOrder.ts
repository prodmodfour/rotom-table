import type { MoveEffectOperation } from '#shared/moveAutomation/effects'
import {
  compareMoveReactionOrder,
  moveReactionTimingDefinition,
} from '#shared/moveAutomation/reactions'

export interface OrderedMoveEffectOperationEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

type OperationPosition =
  | 'before'
  | 'before-dependent'
  | 'ordinary'
  | 'after'
  | 'after-dependent'

const requestPosition = (
  operation: MoveEffectOperation,
): 'before' | 'after' | null => {
  if (operation.kind !== 'reaction-request') return null
  return moveReactionTimingDefinition(operation.payload.timing).operationPosition
    === 'before-phase-operations'
    ? 'before'
    : 'after'
}

const positionRank = (position: OperationPosition): number => {
  if (position === 'before') return 0
  if (position === 'before-dependent') return 1
  if (position === 'ordinary') return 2
  if (position === 'after') return 3
  return 4
}

/**
 * Place reaction checkpoints around ordinary phase operations, keeping direct
 * response-owned effects immediately on the checkpoint's side of ordinary
 * work. Simultaneous windows use descending priority and stable reviewed
 * operation identity; ordinary operation order remains behavior-significant.
 */
export const orderMoveReactionOperationEntries = <
  Entry extends OrderedMoveEffectOperationEntry,
>(entries: readonly Entry[]): readonly Entry[] => {
  const sourceIndex = new Map(entries.map((entry, index) => [entry, index]))
  const requestPositionById = new Map(entries.flatMap(entry => {
    const position = requestPosition(entry.operation)
    return position === null ? [] : [[entry.operation.id, position] as const]
  }))
  const operationPosition = (operation: MoveEffectOperation): OperationPosition => {
    const position = requestPosition(operation)
    if (position !== null) return position
    const sourceRequestPosition = operation.source.kind === 'operation'
      ? requestPositionById.get(operation.source.id) ?? null
      : null
    return sourceRequestPosition === 'before'
      ? 'before-dependent'
      : sourceRequestPosition === 'after'
        ? 'after-dependent'
        : 'ordinary'
  }
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
