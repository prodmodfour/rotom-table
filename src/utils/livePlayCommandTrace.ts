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
  events: LivePlayCommandTraceEvent[]
}

export interface LivePlayCommandTracer {
  readonly record: (input: LivePlayCommandTraceRecordInput) => LivePlayCommandTraceSnapshot | null
  readonly hasEvent: (opId: string, event: LivePlayCommandTraceEventType) => boolean
  readonly snapshot: () => Readonly<Record<string, LivePlayCommandTraceSnapshot>>
}

const DEFAULT_MAX_TRACE_COUNT = 100

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
    isTraceDetailValue(entry[1])
  ))
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
} = {}): LivePlayCommandTracer => {
  const now = options.now ?? (() => Date.now())
  const maxTraces = Math.max(1, Math.floor(options.maxTraces ?? DEFAULT_MAX_TRACE_COUNT))
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
