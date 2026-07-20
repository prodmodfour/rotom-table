import { MOVE_AUTOMATION_ENGINE_BUDGETS } from '#shared/moveAutomation/performanceBudgets'

export const LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES = {
  BUILT: 'built',
  PREDICTED: 'predicted',
  ENQUEUED: 'enqueued',
  CLAIMED: 'claimed',
  SENT: 'sent',
  HTTP_TERMINAL: 'http-terminal',
  SSE_TERMINAL: 'sse-terminal',
  PATCH_ADOPTED: 'patch-adopted',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  ROLLED_BACK: 'rolled-back',
  UNCERTAIN: 'uncertain',
  PLANNED: 'planned',
  WAITING_FOR_RESPONSE: 'waiting-for-response',
  RESUMED: 'resumed',
  COMMITTED: 'committed',
  LIFECYCLE_APPLIED: 'lifecycle-applied',
  CONFLICT: 'conflict',
  RECOVERED: 'recovered',
  RECONCILED: 'reconciled',
} as const

export type LivePlayCommandTraceEventType = typeof LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES[
  keyof typeof LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES
]

export type LivePlayCommandTraceStatus = 'pending' | 'confirmed' | 'rejected' | 'rolled-back' | 'uncertain'
export type LivePlayCommandTraceDetailValue = string | number | boolean | null
export type LivePlayCommandTraceEventDetail = Readonly<Record<string, LivePlayCommandTraceDetailValue>>

export interface LivePlayCommandTraceMetadata {
  readonly opId: string
  readonly requestPath?: string
  readonly commandType?: string
  readonly baseRevision?: number
  readonly resourceSummary?: string
  readonly runtimeKind?: 'legacy-v1' | 'movespec-v2'
  readonly runtimeVersion?: number
  readonly definitionHash?: string
}

export interface LivePlayCommandTraceEvent {
  readonly type: LivePlayCommandTraceEventType
  readonly sequence: number
  readonly timestamp: number
  readonly detail?: LivePlayCommandTraceEventDetail
}

export interface LivePlayCommandTraceSnapshot extends LivePlayCommandTraceMetadata {
  readonly status: LivePlayCommandTraceStatus
  readonly firstSequence: number
  readonly lastSequence: number
  readonly startedAt: number
  readonly updatedAt: number
  readonly events: readonly LivePlayCommandTraceEvent[]
}

export interface LivePlayCommandTraceRecordInput extends LivePlayCommandTraceMetadata {
  readonly event: LivePlayCommandTraceEventType
  readonly detail?: LivePlayCommandTraceEventDetail
}

interface MutableLivePlayCommandTrace {
  opId: string
  requestPath?: string
  commandType?: string
  baseRevision?: number
  resourceSummary?: string
  runtimeKind?: 'legacy-v1' | 'movespec-v2'
  runtimeVersion?: number
  definitionHash?: string
  events: LivePlayCommandTraceEvent[]
}

export interface LivePlayCommandTracer {
  readonly record: (input: LivePlayCommandTraceRecordInput) => LivePlayCommandTraceSnapshot | null
  readonly hasEvent: (opId: string, event: LivePlayCommandTraceEventType) => boolean
  readonly snapshot: () => Readonly<Record<string, LivePlayCommandTraceSnapshot>>
}

const DEFAULT_MAX_TRACE_COUNT = 100
const DEFAULT_MAX_EVENTS_PER_TRACE = MOVE_AUTOMATION_ENGINE_BUDGETS.traceEventsPerOperation
const SAFE_DETAIL_KEYS = new Set([
  'applied',
  'outcome',
  'origin',
  'reason',
  'reasonCode',
  'revision',
  'operationCount',
  'targetCount',
  'resourceCount',
  'retryCount',
  'reconcileCount',
  'durationMs',
  'planDurationMs',
  'responseWaitMs',
  'resumeDurationMs',
  'commitDurationMs',
  'lifecycleDurationMs',
])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const RUNTIME_KINDS = new Set(['legacy-v1', 'movespec-v2'])

const restartsPendingTrace = (event: LivePlayCommandTraceEventType): boolean => (
  event === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT
  || event === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED
  || event === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.ENQUEUED
  || event === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CLAIMED
  || event === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.SENT
)

const traceStatus = (events: readonly LivePlayCommandTraceEvent[]): LivePlayCommandTraceStatus => {
  let status: LivePlayCommandTraceStatus = 'pending'
  for (const event of events) {
    if (event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFIRMED) status = 'confirmed'
    else if (event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.REJECTED) status = 'rejected'
    else if (event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.UNCERTAIN) status = 'uncertain'
    else if (event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.ROLLED_BACK) status = 'rolled-back'
    else if (event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.CONFLICT) status = 'rejected'
    else if (status === 'rolled-back' && restartsPendingTrace(event.type)) status = 'pending'
  }
  return status
}

const isTraceDetailValue = (value: unknown): value is LivePlayCommandTraceDetailValue => (
  value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
)

const sanitizeDetail = (
  detail: LivePlayCommandTraceEventDetail | undefined,
): LivePlayCommandTraceEventDetail | undefined => {
  if (!detail) return undefined
  const entries = Object.entries(detail).filter((entry): entry is [string, LivePlayCommandTraceDetailValue] => (
    SAFE_DETAIL_KEYS.has(entry[0])
    && isTraceDetailValue(entry[1])
  )).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.slice(0, 160) : value,
  ] as const)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

const snapshotTrace = (trace: MutableLivePlayCommandTrace): LivePlayCommandTraceSnapshot => {
  const events = trace.events.map((event): LivePlayCommandTraceEvent => ({
    type: event.type,
    sequence: event.sequence,
    timestamp: event.timestamp,
    ...(event.detail === undefined ? {} : { detail: { ...event.detail } }),
  }))
  const first = events[0]
  const last = events[events.length - 1]
  return {
    opId: trace.opId,
    ...(trace.requestPath === undefined ? {} : { requestPath: trace.requestPath }),
    ...(trace.commandType === undefined ? {} : { commandType: trace.commandType }),
    ...(trace.baseRevision === undefined ? {} : { baseRevision: trace.baseRevision }),
    ...(trace.resourceSummary === undefined ? {} : { resourceSummary: trace.resourceSummary }),
    ...(trace.runtimeKind === undefined ? {} : { runtimeKind: trace.runtimeKind }),
    ...(trace.runtimeVersion === undefined ? {} : { runtimeVersion: trace.runtimeVersion }),
    ...(trace.definitionHash === undefined ? {} : { definitionHash: trace.definitionHash }),
    status: traceStatus(events),
    firstSequence: first?.sequence ?? 0,
    lastSequence: last?.sequence ?? 0,
    startedAt: first?.timestamp ?? 0,
    updatedAt: last?.timestamp ?? 0,
    events,
  }
}

const isNonEmptyString = (value: string): boolean => value.trim().length > 0

export const createLivePlayCommandTracer = (options: {
  readonly now?: () => number
  readonly maxTraces?: number
  readonly maxEventsPerTrace?: number
} = {}): LivePlayCommandTracer => {
  const now = options.now ?? (() => Date.now())
  const maxTraces = Math.max(1, Math.floor(options.maxTraces ?? DEFAULT_MAX_TRACE_COUNT))
  const maxEventsPerTrace = Math.max(1, Math.floor(options.maxEventsPerTrace ?? DEFAULT_MAX_EVENTS_PER_TRACE))
  const traces = new Map<string, MutableLivePlayCommandTrace>()
  let sequence = 0

  const pruneOldTraces = (): void => {
    if (traces.size <= maxTraces) return
    const ordered = [...traces.values()].sort((left, right) => {
      const leftLast = left.events[left.events.length - 1]?.sequence ?? 0
      const rightLast = right.events[right.events.length - 1]?.sequence ?? 0
      return leftLast - rightLast
    })
    for (let index = 0; traces.size > maxTraces && index < ordered.length; index += 1) {
      traces.delete(ordered[index]!.opId)
    }
  }

  const updateMetadata = (
    trace: MutableLivePlayCommandTrace,
    input: LivePlayCommandTraceMetadata,
  ): void => {
    if (input.requestPath !== undefined) trace.requestPath = input.requestPath
    if (input.commandType !== undefined) trace.commandType = input.commandType
    if (input.baseRevision !== undefined) trace.baseRevision = input.baseRevision
    if (input.resourceSummary !== undefined && isNonEmptyString(input.resourceSummary)) {
      trace.resourceSummary = input.resourceSummary.slice(0, 160)
    }
    if (input.runtimeKind !== undefined && RUNTIME_KINDS.has(input.runtimeKind)) {
      trace.runtimeKind = input.runtimeKind
    }
    if (input.runtimeVersion !== undefined && Number.isSafeInteger(input.runtimeVersion) && input.runtimeVersion > 0) {
      trace.runtimeVersion = input.runtimeVersion
    }
    if (input.definitionHash !== undefined && SHA256_PATTERN.test(input.definitionHash)) {
      trace.definitionHash = input.definitionHash
    }
  }

  const record = (input: LivePlayCommandTraceRecordInput): LivePlayCommandTraceSnapshot | null => {
    if (!isNonEmptyString(input.opId)) return null
    const existing = traces.get(input.opId)
    const trace: MutableLivePlayCommandTrace = existing ?? { opId: input.opId, events: [] }
    updateMetadata(trace, input)
    sequence += 1
    const detail = sanitizeDetail(input.detail)
    trace.events.push({
      type: input.event,
      sequence,
      timestamp: now(),
      ...(detail === undefined ? {} : { detail }),
    })
    if (trace.events.length > maxEventsPerTrace) {
      trace.events.splice(0, trace.events.length - maxEventsPerTrace)
    }
    traces.set(input.opId, trace)
    pruneOldTraces()
    return snapshotTrace(trace)
  }

  const hasEvent = (opId: string, event: LivePlayCommandTraceEventType): boolean => (
    traces.get(opId)?.events.some((traceEvent) => traceEvent.type === event) ?? false
  )

  const snapshot = (): Readonly<Record<string, LivePlayCommandTraceSnapshot>> => {
    const entries = [...traces.entries()].map(([opId, trace]) => [opId, snapshotTrace(trace)] as const)
    return Object.fromEntries(entries)
  }

  return { record, hasEvent, snapshot }
}
