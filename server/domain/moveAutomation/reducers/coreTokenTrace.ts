import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type { MoveCoreTokenEffectOperationResult } from './coreTokenEffectTypes'

const traceResult = (
  result: MoveCoreTokenEffectOperationResult,
): MoveResolutionTraceJsonValue => ({
  status: result.outcome,
  recipients: result.recipients.map(recipient => ({
    recipientId: recipient.recipientId,
    outcome: recipient.outcome,
    reasonCode: recipient.reasonCode,
    blockers: recipient.blockers.map(blocker => ({ ...blocker })),
    ...(recipient.details === undefined ? {} : { details: recipient.details }),
    previous: recipient.previous,
    current: recipient.current,
    changedFields: [...recipient.changedFields],
  })),
}) as unknown as MoveResolutionTraceJsonValue

/** Replace interpreter "emitted" placeholders with bounded reducer outcomes. */
export const applyMoveCoreTokenEffectResultsToTrace = (
  trace: MoveResolutionAuditTrace,
  results: readonly MoveCoreTokenEffectOperationResult[],
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
      return failMoveCoreTokenEffectReduction(
        'trace-operation-mismatch',
        `Trace event for ${result.operationId} does not match its core effect operation.`,
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
      failMoveCoreTokenEffectReduction(
        'trace-operation-missing',
        `Trace is missing core operation ${result.operationId}.`,
      )
    }
  }
  return parseMoveResolutionAuditTrace({ ...trace, events })
}
