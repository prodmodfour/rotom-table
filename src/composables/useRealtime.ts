/**
 * Client-side multiplexer for the `/api/events` SSE stream.
 *
 * A single browser EventSource is owned by the current realtime principal
 * context (auth role + selected player profile). Channel subscribers stay
 * registered while context changes restart the transport with a context-scoped
 * replay cursor.
 */
import { onBeforeUnmount, watch } from 'vue'
import { API_EVENTS_PATH } from '~/utils/apiRoutes'
import {
  REALTIME_REPLAY_QUERY_PARAMETER,
  parseRealtimeReplayControlMessage,
  parseRealtimeStreamPayload,
  type RealtimeReplayControlMessage,
  type RealtimeReplayReconcileRequiredControl,
  type RealtimeStreamPayload,
} from '#shared/realtimeReplay'
import type { SequencedRealtimeEvent } from '#shared/realtimeEventLog'
import type { RealtimeEvent } from '#shared/realtime'
import {
  buildRealtimeClientPrincipalContextKey,
  realtimeClientPrincipalContext,
  realtimeClientPrincipalContextKey,
  type RealtimeClientPrincipalContext,
} from '~/utils/realtimeClientPrincipalContext'
import {
  realtimeCursorStorage,
  type RealtimeCursorStorage,
} from '~/utils/realtimeCursorStorage'

export type { RealtimeEvent } from '#shared/realtime'

export type RealtimeConnectionState = 'idle' | 'connecting' | 'reconnecting' | 'replaying' | 'connected'

export type RealtimeConnectionChangeReason =
  | 'idle'
  | 'connecting'
  | 'context-changed'
  | 'transport-open'
  | 'transport-loss'
  | 'replay-caught-up'
  | 'reconcile-required'
  | 'malformed-message'
  | 'handler-error'

export interface RealtimeReplayCaughtUpDetails {
  readonly requestedAfterSequence: number | null
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
  readonly replayedThroughSequence: number
}

export interface RealtimeReconciliationRequirement {
  readonly reason: 'gap' | 'ahead'
  readonly requestedAfterSequence: number
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
}

export interface RealtimeConnectionChange {
  readonly state: RealtimeConnectionState
  readonly previousState: RealtimeConnectionState
  readonly reconnected: boolean
  readonly reason: RealtimeConnectionChangeReason
  readonly generation: number
  readonly contextKey: string | null
  readonly replayCaughtUp?: RealtimeReplayCaughtUpDetails
  readonly reconciliation?: RealtimeReconciliationRequirement
  readonly error?: string
}

type Handler = (event: RealtimeEvent) => void
type ConnectionHandler = (change: RealtimeConnectionChange) => void

export interface SubscribeRealtimeConnectionOptions {
  readonly immediate?: boolean
}

type TimerHandle = ReturnType<typeof setTimeout>

interface ChannelEntry {
  handlers: Set<Handler>
}

interface EventSourceMessageLike {
  readonly data: string
}

interface EventSourceLike {
  onopen: (() => void) | null
  onmessage: ((message: EventSourceMessageLike) => void) | null
  onerror: (() => void) | null
  close(): void
}

interface EventSourceConstructorLike {
  new(url: string): EventSourceLike
}

interface TimerApi {
  readonly setTimeout: (handler: () => void, timeout: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
}

export interface RealtimeRuntimeDependenciesForTests {
  readonly eventSourceConstructor?: EventSourceConstructorLike | null
  readonly timers?: TimerApi | null
  readonly cursorStorage?: RealtimeCursorStorage | null
  readonly locationHref?: string | null
}

interface SourceContext {
  readonly generation: number
  readonly contextKey: string
  readonly reconnected: boolean
}

interface ParsedIncomingMessage {
  readonly kind: 'control' | 'sequenced-event' | 'transient-event'
  readonly control?: RealtimeReplayControlMessage
  readonly event?: RealtimeEvent
}

type UnknownRecord = Record<string, unknown>

const channels = new Map<string, ChannelEntry>()
const connectionHandlers = new Set<ConnectionHandler>()

let source: EventSourceLike | null = null
let reconnectTimer: TimerHandle | null = null
let reconnectAttempts = 0
let connectionState: RealtimeConnectionState = 'idle'
let connectionGeneration = 0
let activeContextKey: string | null = realtimeClientPrincipalContextKey.value
let sourceContextKey: string | null = null
let hadCaughtUpInContext = false
let reconnectingAfterLoss = false

let eventSourceConstructorOverride: EventSourceConstructorLike | null | undefined
let timerApiOverride: TimerApi | null | undefined
let cursorStorageOverride: RealtimeCursorStorage | null | undefined
let locationHrefOverride: string | null | undefined

const hasOwn = (value: object, key: PropertyKey): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
)

const isPlainObject = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const getTimerApi = (): TimerApi => timerApiOverride ?? {
  setTimeout: (handler, timeout) => setTimeout(handler, timeout),
  clearTimeout: (handle) => clearTimeout(handle),
}

const getCursorStorage = (): RealtimeCursorStorage => cursorStorageOverride ?? realtimeCursorStorage

const getEventSourceConstructor = (): EventSourceConstructorLike | null => {
  if (eventSourceConstructorOverride !== undefined) return eventSourceConstructorOverride
  if (typeof EventSource === 'undefined') return null
  return EventSource as unknown as EventSourceConstructorLike
}

const getBrowserLocationHref = (): string => {
  if (locationHrefOverride !== undefined && locationHrefOverride !== null) return locationHrefOverride
  if (typeof window !== 'undefined' && typeof window.location?.href === 'string') return window.location.href
  return 'http://localhost/'
}

const isBrowserRuntime = (): boolean => typeof window !== 'undefined'

const normalizeErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

const currentPrincipalContext = (): RealtimeClientPrincipalContext | null => realtimeClientPrincipalContext.value

const currentPrincipalContextKey = (): string | null => {
  const context = currentPrincipalContext()
  return context === null ? null : buildRealtimeClientPrincipalContextKey(context)
}

const buildEventSourceUrl = (
  context: RealtimeClientPrincipalContext,
  cursor: number | null,
): string => {
  const url = new URL(API_EVENTS_PATH, getBrowserLocationHref())
  if (context.role === 'player' && context.profileId !== null) {
    url.searchParams.set('profileId', context.profileId)
  }
  if (cursor !== null) url.searchParams.set(REALTIME_REPLAY_QUERY_PARAMETER, String(cursor))
  return `${url.pathname}${url.search}`
}

const notifyConnection = (
  state: RealtimeConnectionState,
  details: {
    readonly reason: RealtimeConnectionChangeReason
    readonly reconnected?: boolean
    readonly contextKey?: string | null
    readonly replayCaughtUp?: RealtimeReplayCaughtUpDetails
    readonly reconciliation?: RealtimeReconciliationRequirement
    readonly error?: string
    readonly force?: boolean
  },
): void => {
  if (state === connectionState && details.force !== true) return
  const previousState = connectionState
  connectionState = state
  const change: RealtimeConnectionChange = {
    state,
    previousState,
    reconnected: details.reconnected === true,
    reason: details.reason,
    generation: connectionGeneration,
    contextKey: details.contextKey ?? sourceContextKey ?? activeContextKey,
    ...(details.replayCaughtUp ? { replayCaughtUp: details.replayCaughtUp } : {}),
    ...(details.reconciliation ? { reconciliation: details.reconciliation } : {}),
    ...(details.error ? { error: details.error } : {}),
  }
  for (const handler of Array.from(connectionHandlers)) {
    try {
      handler(change)
    } catch (err) {
      console.error('[realtime] connection handler threw', err)
    }
  }
}

const cancelReconnectTimer = (): void => {
  if (!reconnectTimer) return
  getTimerApi().clearTimeout(reconnectTimer)
  reconnectTimer = null
}

const closeSource = (): void => {
  if (!source) return
  source.close()
  source = null
  sourceContextKey = null
}

const scheduleReconnect = (): void => {
  cancelReconnectTimer()
  if (channels.size === 0) return
  if (currentPrincipalContext() === null) return
  reconnectAttempts = Math.min(reconnectAttempts + 1, 6)
  const delay = Math.min(500 * 2 ** reconnectAttempts, 8000)
  reconnectTimer = getTimerApi().setTimeout(() => {
    reconnectTimer = null
    ensureSource()
  }, delay)
}

const isCurrentSourceContext = (context: SourceContext): boolean => (
  context.generation === connectionGeneration
  && context.contextKey === activeContextKey
  && sourceContextKey === context.contextKey
)

const dispatchToChannel = (event: RealtimeEvent, sourceContext: SourceContext): void => {
  const entry = channels.get(event.channel)
  let handlerFailed = false
  if (entry) {
    for (const handler of Array.from(entry.handlers)) {
      try {
        handler(event)
      } catch (err) {
        handlerFailed = true
        console.error('[realtime] handler threw', err)
      }
    }
  }

  if (handlerFailed && isCurrentSourceContext(sourceContext)) {
    notifyConnection(connectionState, {
      reason: 'handler-error',
      reconnected: sourceContext.reconnected,
      contextKey: sourceContext.contextKey,
      error: 'A realtime channel handler failed while processing an accepted event.',
      force: true,
    })
  }
}

const assertNoAccessDescriptor = (record: UnknownRecord): void => {
  if (hasOwn(record, 'access')) throw new Error('realtime stream payload must not include access descriptors')
}

const isControlRecord = (record: UnknownRecord): boolean => record.kind === 'realtime-control'

const isSequencedEventPayload = (payload: RealtimeStreamPayload): payload is SequencedRealtimeEvent => (
  !('kind' in payload && payload.kind === 'realtime-control')
)

const parseTransientRealtimeEvent = (value: unknown): RealtimeEvent => {
  if (!isPlainObject(value)) throw new Error('transient realtime event must be a plain object')
  if (hasOwn(value, 'sequence')) throw new Error('transient realtime event must not include sequence')
  assertNoAccessDescriptor(value)

  // Reuse the shared strict sequenced-event parser for all legacy event
  // structure checks by validating a detached candidate with a synthetic
  // sequence. The routed event remains the original unsequenced payload.
  const candidate = { ...value, sequence: 0 }
  const parsed = parseRealtimeStreamPayload(candidate)
  if (!isSequencedEventPayload(parsed)) throw new Error('transient realtime event must not be a control message')
  return value as unknown as RealtimeEvent
}

const parseIncomingMessage = (raw: string): ParsedIncomingMessage => {
  const parsedJson = JSON.parse(raw) as unknown
  if (!isPlainObject(parsedJson)) throw new Error('realtime stream payload must be a plain object')
  assertNoAccessDescriptor(parsedJson)

  if (isControlRecord(parsedJson)) {
    return { kind: 'control', control: parseRealtimeReplayControlMessage(parsedJson) }
  }

  if (hasOwn(parsedJson, 'sequence')) {
    const payload = parseRealtimeStreamPayload(parsedJson)
    if (!isSequencedEventPayload(payload)) throw new Error('sequenced realtime event must not be a control message')
    return { kind: 'sequenced-event', event: payload }
  }

  return { kind: 'transient-event', event: parseTransientRealtimeEvent(parsedJson) }
}

const handleReplayCaughtUpControl = (
  control: Extract<RealtimeReplayControlMessage, { readonly type: 'replay-caught-up' }>,
  sourceContext: SourceContext,
): void => {
  const persistedCursor = getCursorStorage().advanceCursor(
    sourceContext.contextKey,
    control.replayedThroughSequence,
  )
  hadCaughtUpInContext = true
  reconnectingAfterLoss = false
  reconnectAttempts = 0
  notifyConnection('connected', {
    reason: 'replay-caught-up',
    reconnected: sourceContext.reconnected,
    contextKey: sourceContext.contextKey,
    replayCaughtUp: {
      requestedAfterSequence: control.requestedAfterSequence,
      earliestAvailableSequence: control.earliestAvailableSequence,
      latestSequence: control.latestSequence,
      replayedThroughSequence: persistedCursor,
    },
    force: connectionState === 'connected',
  })
}

const reconciliationDetails = (
  control: RealtimeReplayReconcileRequiredControl,
): RealtimeReconciliationRequirement => ({
  reason: control.reason,
  requestedAfterSequence: control.requestedAfterSequence,
  earliestAvailableSequence: control.earliestAvailableSequence,
  latestSequence: control.latestSequence,
})

const handleReconcileRequiredControl = (
  control: RealtimeReplayReconcileRequiredControl,
  sourceContext: SourceContext,
): void => {
  // The server's cursor state is authoritative for both retained gaps and an
  // ahead client cursor. Replacement (not monotonic advance) prevents an ahead
  // cursor from surviving reconnect and requesting the same impossible range.
  getCursorStorage().replaceCursor(sourceContext.contextKey, control.latestSequence)
  notifyConnection('replaying', {
    reason: 'reconcile-required',
    reconnected: sourceContext.reconnected,
    contextKey: sourceContext.contextKey,
    reconciliation: reconciliationDetails(control),
    force: true,
  })
}

const handleControlMessage = (
  control: RealtimeReplayControlMessage,
  sourceContext: SourceContext,
): void => {
  if (control.type === 'replay-caught-up') {
    handleReplayCaughtUpControl(control, sourceContext)
    return
  }
  handleReconcileRequiredControl(control, sourceContext)
}

const handleSequencedEvent = (
  event: RealtimeEvent,
  sourceContext: SourceContext,
): void => {
  if (typeof event.sequence !== 'number') throw new Error('sequenced realtime event sequence is missing')
  const currentCursor = getCursorStorage().readCursor(sourceContext.contextKey)
  if (currentCursor !== null && event.sequence <= currentCursor) return

  dispatchToChannel(event, sourceContext)
  if (activeContextKey !== sourceContext.contextKey) return
  getCursorStorage().advanceCursor(sourceContext.contextKey, event.sequence)
}

const closeAndReconnectAfterUnsafeStreamError = (
  sourceContext: SourceContext,
  reason: 'malformed-message',
  error: unknown,
): void => {
  if (!isCurrentSourceContext(sourceContext)) return
  console.warn('[realtime] unsafe stream payload; reconnecting', error)
  closeSource()
  reconnectingAfterLoss = hadCaughtUpInContext || sourceContext.reconnected
  notifyConnection('reconnecting', {
    reason,
    reconnected: reconnectingAfterLoss,
    contextKey: sourceContext.contextKey,
    error: normalizeErrorMessage(error),
    force: true,
  })
  scheduleReconnect()
}

const handleMessage = (raw: string, sourceContext: SourceContext): void => {
  if (!isCurrentSourceContext(sourceContext)) return

  let parsed: ParsedIncomingMessage
  try {
    parsed = parseIncomingMessage(raw)
  } catch (error) {
    closeAndReconnectAfterUnsafeStreamError(sourceContext, 'malformed-message', error)
    return
  }

  if (!isCurrentSourceContext(sourceContext)) return

  if (parsed.kind === 'control') {
    handleControlMessage(parsed.control as RealtimeReplayControlMessage, sourceContext)
    return
  }

  if (!parsed.event) return
  if (parsed.kind === 'sequenced-event') {
    handleSequencedEvent(parsed.event, sourceContext)
    return
  }

  dispatchToChannel(parsed.event, sourceContext)
}

const handleTransportError = (sourceContext: SourceContext): void => {
  if (!isCurrentSourceContext(sourceContext)) return
  closeSource()
  reconnectingAfterLoss = hadCaughtUpInContext || sourceContext.reconnected
  notifyConnection('reconnecting', {
    reason: 'transport-loss',
    reconnected: reconnectingAfterLoss,
    contextKey: sourceContext.contextKey,
  })
  scheduleReconnect()
}

const openSource = (
  context: RealtimeClientPrincipalContext,
  startReason: 'connecting' | 'context-changed' = 'connecting',
): void => {
  const EventSourceConstructor = getEventSourceConstructor()
  if (!EventSourceConstructor) return

  const contextKey = buildRealtimeClientPrincipalContextKey(context)
  activeContextKey = contextKey
  const cursor = getCursorStorage().readCursor(contextKey)
  const url = buildEventSourceUrl(context, cursor)
  const reconnected = reconnectingAfterLoss || hadCaughtUpInContext
  const nextState: RealtimeConnectionState = reconnected ? 'reconnecting' : 'connecting'
  const generation = ++connectionGeneration
  notifyConnection(nextState, {
    reason: startReason,
    reconnected,
    contextKey,
    force: startReason === 'context-changed',
  })

  sourceContextKey = contextKey
  const sourceContext: SourceContext = { generation, contextKey, reconnected }

  let nextSource: EventSourceLike
  try {
    nextSource = new EventSourceConstructor(url)
  } catch (error) {
    console.warn('[realtime] EventSource construction failed', error)
    sourceContextKey = null
    notifyConnection('reconnecting', {
      reason: 'transport-loss',
      reconnected,
      contextKey,
      error: normalizeErrorMessage(error),
      force: true,
    })
    reconnectingAfterLoss = reconnected
    scheduleReconnect()
    return
  }

  source = nextSource
  nextSource.onopen = () => {
    if (!isCurrentSourceContext(sourceContext)) return
    reconnectAttempts = 0
    notifyConnection('replaying', {
      reason: 'transport-open',
      reconnected,
      contextKey,
      force: connectionState === 'replaying',
    })
  }
  nextSource.onmessage = (msg) => handleMessage(msg.data, sourceContext)
  nextSource.onerror = () => handleTransportError(sourceContext)
}

function ensureSource(startReason: 'connecting' | 'context-changed' = 'connecting'): void {
  if (!isBrowserRuntime()) return
  if (source) return
  if (channels.size === 0) return

  const context = currentPrincipalContext()
  if (context === null) return
  openSource(context, startReason)
}

const resetConnectionLifecycleForContext = (): void => {
  connectionGeneration += 1
  closeSource()
  cancelReconnectTimer()
  reconnectAttempts = 0
  hadCaughtUpInContext = false
  reconnectingAfterLoss = false
}

const handlePrincipalContextChanged = (): void => {
  const nextKey = currentPrincipalContextKey()
  if (nextKey === activeContextKey) return
  activeContextKey = nextKey
  resetConnectionLifecycleForContext()

  if (nextKey === null || channels.size === 0) {
    notifyConnection('idle', {
      reason: nextKey === null ? 'idle' : 'context-changed',
      contextKey: nextKey,
      force: connectionState !== 'idle',
    })
    return
  }

  ensureSource('context-changed')
}

watch(
  realtimeClientPrincipalContextKey,
  handlePrincipalContextChanged,
  { flush: 'sync' },
)

const teardownIfEmpty = (): void => {
  if (channels.size > 0) return
  resetConnectionLifecycleForContext()
  if (connectionState !== 'idle') {
    notifyConnection('idle', {
      reason: 'idle',
      contextKey: activeContextKey,
      force: true,
    })
  }
}

export const getRealtimeConnectionSnapshot = (): RealtimeConnectionChange => ({
  state: connectionState,
  previousState: connectionState,
  reconnected: reconnectingAfterLoss,
  reason: connectionState === 'idle' ? 'idle' : 'connecting',
  generation: connectionGeneration,
  contextKey: activeContextKey,
})

export const subscribeRealtimeConnection = (
  handler: ConnectionHandler,
  options: SubscribeRealtimeConnectionOptions = {},
): (() => void) => {
  connectionHandlers.add(handler)
  if (options.immediate === true) {
    try {
      handler(getRealtimeConnectionSnapshot())
    } catch (err) {
      console.error('[realtime] connection handler threw', err)
    }
  }
  return () => {
    connectionHandlers.delete(handler)
  }
}

export const subscribeChannel = (channel: string, handler: Handler): (() => void) => {
  let entry = channels.get(channel)
  if (!entry) {
    entry = { handlers: new Set() }
    channels.set(channel, entry)
  }
  entry.handlers.add(handler)
  ensureSource()
  return () => {
    const current = channels.get(channel)
    if (!current) return
    current.handlers.delete(handler)
    if (current.handlers.size === 0) channels.delete(channel)
    teardownIfEmpty()
  }
}

/**
 * Component-scoped subscription. Auto-cleans on unmount. Safe to call during
 * SSR (no browser EventSource/storage access happens outside the browser).
 */
export const useRealtimeChannel = (channel: string, handler: Handler): (() => void) => {
  const unsubscribe = subscribeChannel(channel, handler)
  onBeforeUnmount(unsubscribe)
  return unsubscribe
}

export const configureRealtimeForTests = (dependencies: RealtimeRuntimeDependenciesForTests = {}): void => {
  if ('eventSourceConstructor' in dependencies) {
    eventSourceConstructorOverride = dependencies.eventSourceConstructor ?? null
  }
  if ('timers' in dependencies) timerApiOverride = dependencies.timers ?? null
  if ('cursorStorage' in dependencies) cursorStorageOverride = dependencies.cursorStorage ?? null
  if ('locationHref' in dependencies) locationHrefOverride = dependencies.locationHref ?? null
}

export const resetRealtimeForTests = (): void => {
  resetConnectionLifecycleForContext()
  channels.clear()
  connectionHandlers.clear()
  reconnectAttempts = 0
  connectionState = 'idle'
  connectionGeneration = 0
  activeContextKey = realtimeClientPrincipalContextKey.value
  sourceContextKey = null
  hadCaughtUpInContext = false
  reconnectingAfterLoss = false
  eventSourceConstructorOverride = undefined
  timerApiOverride = undefined
  cursorStorageOverride = undefined
  locationHrefOverride = undefined
}
