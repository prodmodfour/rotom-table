import {
  parseMoveResolutionTraceSummary,
  type MoveResolutionTraceSummary,
  type MoveResolutionWireTraceEvent,
} from './trace'

const eventLogLine = (event: MoveResolutionWireTraceEvent): string => {
  if (event.kind === 'phase-transition') {
    return `Phase ${event.from ?? 'start'} -> ${event.to} (${event.reasonCode}).`
  }
  if (event.kind === 'predicate') {
    return `Predicate ${event.predicateId}: ${event.outcome ? 'passed' : 'failed'} (${event.reasonCode}).`
  }
  if (event.kind === 'target') {
    return `Target ${event.targetId}: ${event.outcome} (${event.reasonCode}).`
  }
  if (event.kind === 'roll') {
    return `Roll ${event.rollId}: ${event.naturalResult} -> ${event.finalValue} (${event.reasonCode}).`
  }
  if (event.kind === 'operation') {
    const recipients = event.recipientIds.length ? event.recipientIds.join(', ') : 'no recipients'
    return `Operation ${event.operationId} [${event.operationKind}]: ${event.outcome} for ${recipients} (${event.reasonCode}).`
  }
  if (event.kind === 'choice') {
    return `${event.requestKind === 'reaction' ? 'Reaction' : 'Choice'} ${event.requestId}: ${event.outcome} (${event.reasonCode}).`
  }
  return `Child move ${event.childResolutionId} (${event.canonicalId}): ${event.outcome} (${event.reasonCode}).`
}

/** Render deterministic audit lines without server-only operation data or selected option IDs. */
export const renderMoveResolutionTraceLogLines = (
  value: MoveResolutionTraceSummary,
): readonly string[] => {
  const trace = parseMoveResolutionTraceSummary(value)
  const lines = [
    `Runtime ${trace.program.runtimeKind} v${trace.program.runtimeVersion} for ${trace.program.canonicalId} (${trace.program.definitionHash}); ruleset ${trace.ruleset.rulesetId} (${trace.ruleset.sourceDataSha256}).`,
    ...trace.events.map(eventLogLine),
  ]
  if (trace.truncated) lines.push(`Trace summary contains ${trace.events.length} of ${trace.totalEventCount} events.`)
  return Object.freeze(lines)
}
