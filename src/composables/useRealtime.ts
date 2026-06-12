/**
 * Client-side multiplexer for the `/api/events` SSE stream.
 *
 * One ``EventSource`` per page (across the whole app), with channel-
 * scoped subscribe/unsubscribe so a map editor can listen on multiple
 * channels (its own map + several sheets) without opening multiple
 * HTTP connections.
 *
 * Disconnects auto-reconnect after a short backoff. Channel subscribers
 * receive realtime events only while connected; connection subscribers
 * are notified when a gap may have occurred so live-play map views can
 * reload authoritative state before sending more revision-based commands.
 */
import { onBeforeUnmount } from 'vue'
import { API_EVENTS_PATH } from '~/utils/apiRoutes'
import type { RealtimeEvent } from '#shared/realtime'

export type { RealtimeEvent } from '#shared/realtime'

type Handler = (event: RealtimeEvent) => void

export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting'

export interface RealtimeConnectionChange {
  readonly state: RealtimeConnectionState
  readonly previousState: RealtimeConnectionState
  readonly reconnected: boolean
}

type ConnectionHandler = (change: RealtimeConnectionChange) => void

interface ChannelEntry {
  handlers: Set<Handler>
}

const channels = new Map<string, ChannelEntry>()
const connectionHandlers = new Set<ConnectionHandler>()
let source: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let connectionState: RealtimeConnectionState = 'idle'
let hadSuccessfulConnection = false
let reconnectGapObserved = false

const dispatch = (raw: string) => {
  let event: RealtimeEvent
  try {
    event = JSON.parse(raw) as RealtimeEvent
  } catch (err) {
    console.warn('[realtime] bad payload', err)
    return
  }
  const entry = channels.get(event.channel)
  if (!entry) return
  for (const handler of entry.handlers) {
    try {
      handler(event)
    } catch (err) {
      console.error('[realtime] handler threw', err)
    }
  }
}

const notifyConnection = (
  state: RealtimeConnectionState,
  reconnected = false,
) => {
  if (state === connectionState && !reconnected) return
  const previousState = connectionState
  connectionState = state
  const change: RealtimeConnectionChange = { state, previousState, reconnected }
  for (const handler of connectionHandlers) {
    try {
      handler(change)
    } catch (err) {
      console.error('[realtime] connection handler threw', err)
    }
  }
}

const ensureSource = () => {
  if (typeof window === 'undefined') return
  if (source) return
  if (channels.size === 0) return

  notifyConnection(hadSuccessfulConnection || reconnectGapObserved ? 'reconnecting' : 'connecting')
  source = new EventSource(API_EVENTS_PATH)
  source.onopen = () => {
    reconnectAttempts = 0
    const reconnected = reconnectGapObserved
    hadSuccessfulConnection = true
    reconnectGapObserved = false
    notifyConnection('connected', reconnected)
  }
  source.onmessage = (msg) => dispatch(msg.data)
  source.onerror = () => {
    if (source) {
      source.close()
      source = null
    }
    if (hadSuccessfulConnection) reconnectGapObserved = true
    notifyConnection('reconnecting')
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectAttempts = Math.min(reconnectAttempts + 1, 6)
    const delay = Math.min(500 * 2 ** reconnectAttempts, 8000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      ensureSource()
    }, delay)
  }
}

const teardownIfEmpty = () => {
  if (channels.size > 0) return
  if (source) {
    source.close()
    source = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  hadSuccessfulConnection = false
  reconnectGapObserved = false
  if (connectionState !== 'idle') notifyConnection('idle')
}

export const subscribeRealtimeConnection = (handler: ConnectionHandler): (() => void) => {
  connectionHandlers.add(handler)
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
 * Component-scoped subscription. Auto-cleans on unmount. Safe to call
 * during SSR (no-ops outside the browser).
 */
export const useRealtimeChannel = (channel: string, handler: Handler): (() => void) => {
  const unsubscribe = subscribeChannel(channel, handler)
  onBeforeUnmount(unsubscribe)
  return unsubscribe
}
