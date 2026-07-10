import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  MOVE_RESOLUTION_TRACE_SCHEMA_VERSION,
  parseMoveResolutionAuditTrace,
  parseMoveResolutionTraceSummary,
  type MoveResolutionAuditTrace,
  type MoveResolutionAuditTraceEvent,
  type MoveResolutionAuditTraceEventInput,
  type MoveResolutionTraceAncestryEntry,
  type MoveResolutionTraceProgramIdentity,
  type MoveResolutionTraceRulesetIdentity,
  type MoveResolutionTraceSummary,
  type MoveResolutionWireTraceEvent,
} from '#shared/moveAutomation/trace'

export interface CreateMoveResolutionTraceInput {
  readonly program: MoveResolutionTraceProgramIdentity
  readonly ruleset: MoveResolutionTraceRulesetIdentity
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
}

/** Create an empty immutable audit trace with reviewed runtime/ruleset identity. */
export const createMoveResolutionTrace = (
  input: CreateMoveResolutionTraceInput,
): MoveResolutionAuditTrace => parseMoveResolutionAuditTrace({
  schemaVersion: MOVE_RESOLUTION_TRACE_SCHEMA_VERSION,
  program: input.program,
  ruleset: input.ruleset,
  ancestry: input.ancestry ?? [],
  events: [],
})

/**
 * Pure append reducer. Sequence numbers are server-owned and the shared parser
 * enforces canonical phase flow, JSON safety, identity, and aggregate bounds.
 */
export const reduceMoveResolutionTrace = (
  trace: MoveResolutionAuditTrace,
  event: MoveResolutionAuditTraceEventInput,
): MoveResolutionAuditTrace => parseMoveResolutionAuditTrace({
  ...trace,
  events: [
    ...trace.events,
    {
      ...event,
      sequence: trace.events.length + 1,
    },
  ],
})

const projectAuditEvent = (
  event: MoveResolutionAuditTraceEvent,
): MoveResolutionWireTraceEvent => {
  if (event.kind === 'predicate') {
    return {
      sequence: event.sequence,
      kind: event.kind,
      reasonCode: event.reasonCode,
      phase: event.phase,
      predicateId: event.predicateId,
      outcome: event.outcome,
    }
  }
  if (event.kind === 'roll') {
    return {
      sequence: event.sequence,
      kind: event.kind,
      reasonCode: event.reasonCode,
      phase: event.phase,
      rollId: event.roll.rollId,
      parentEffectId: event.roll.parentEffectId,
      naturalResult: event.roll.naturalResult,
      modifierTotal: event.roll.modifiers.reduce((total, modifier) => total + modifier.value, 0),
      finalValue: event.roll.finalValue,
    }
  }
  if (event.kind === 'operation') {
    return {
      sequence: event.sequence,
      kind: event.kind,
      reasonCode: event.reasonCode,
      phase: event.phase,
      operationId: event.operationId,
      operationKind: event.operationKind,
      recipientIds: [...event.recipientIds],
      outcome: event.outcome,
    }
  }
  if (event.kind === 'choice') {
    return {
      sequence: event.sequence,
      kind: event.kind,
      reasonCode: event.reasonCode,
      phase: event.phase,
      requestId: event.requestId,
      requestKind: event.requestKind,
      outcome: event.outcome,
    }
  }
  return { ...event }
}

const publicAuditEvents = (
  events: readonly MoveResolutionAuditTraceEvent[],
): readonly MoveResolutionAuditTraceEvent[] => events
  .filter(event => event.kind !== 'target' || event.outcome === 'included')
  .map((event, index) => ({ ...event, sequence: index + 1 }))

const boundedWireEvents = (
  events: readonly MoveResolutionAuditTraceEvent[],
): readonly MoveResolutionAuditTraceEvent[] => {
  const limit = MOVE_RESOLUTION_TRACE_LIMITS.wireEvents
  if (events.length <= limit) return events
  const headCount = Math.floor(limit / 2)
  return [
    ...events.slice(0, headCount),
    ...events.slice(events.length - (limit - headCount)),
  ]
}

/**
 * Strip private predicate/operation payloads, selected option IDs, and excluded
 * target identities, while retaining accepted targets and bounded audit shape.
 */
export const summarizeMoveResolutionTrace = (
  value: MoveResolutionAuditTrace,
): MoveResolutionTraceSummary => {
  const trace = parseMoveResolutionAuditTrace(value)
  const publicEvents = publicAuditEvents(trace.events)
  const events = boundedWireEvents(publicEvents).map(projectAuditEvent)
  return parseMoveResolutionTraceSummary({
    schemaVersion: MOVE_RESOLUTION_TRACE_SCHEMA_VERSION,
    program: trace.program,
    ruleset: trace.ruleset,
    ancestry: trace.ancestry,
    totalEventCount: publicEvents.length,
    truncated: publicEvents.length > events.length,
    events,
  })
}
