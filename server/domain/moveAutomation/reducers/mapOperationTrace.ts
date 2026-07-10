import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import { failMoveMapOperationReduction } from './mapOperationError'
import type { MoveMapOperationResult } from './mapOperationTypes'

const traceResult = (
  result: MoveMapOperationResult,
): MoveResolutionTraceJsonValue => ({
  status: result.outcome,
  details: result.details,
})

/** Replace interpreter emission placeholders with bounded map-reducer outcomes. */
export const applyMoveMapOperationResultsToTrace = (
  trace: MoveResolutionAuditTrace,
  results: readonly MoveMapOperationResult[],
): MoveResolutionAuditTrace => {
  const byId = new Map(results.map(result => [result.operationId, result]))
  const matched = new Set<string>()
  const events = trace.events.map((event) => {
    if (event.kind !== 'operation') return event
    const result = byId.get(event.operationId)
    if (!result) return event
    if (
      event.operationKind !== result.operationKind
      || event.phase !== result.phase
      || event.reasonCode !== result.reasonCode
    ) {
      return failMoveMapOperationReduction(
        'trace-operation-mismatch',
        `Trace event for ${result.operationId} does not match its map operation.`,
      )
    }
    matched.add(result.operationId)
    return {
      ...event,
      recipientIds: [...result.recipientIds],
      outcome: result.outcome,
      result: traceResult(result),
    }
  })
  for (const result of results) {
    if (!matched.has(result.operationId)) {
      failMoveMapOperationReduction(
        'trace-operation-missing',
        `Trace is missing map operation ${result.operationId}.`,
      )
    }
  }
  return parseMoveResolutionAuditTrace({ ...trace, events })
}
