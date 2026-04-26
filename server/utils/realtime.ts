/**
 * In-process pub/sub hub for realtime events.
 *
 * Server-side endpoints call ``publishRealtime`` after mutating disk
 * state. The SSE endpoint (`/api/events`) subscribes the connection's
 * response stream and forwards every event to the client. The client
 * (`composables/useRealtime.ts`) routes events to channel-specific
 * handlers.
 *
 * Single-process only — fine for the current dev/local-server setup.
 * If the app ever runs behind multiple Nitro instances we'd swap this
 * for Redis pub/sub or similar.
 */

export interface RealtimeEvent {
  /** Channel name, e.g. ``"grid:foo"`` or ``"sheets"``. */
  channel: string
  /** Operation type, e.g. ``"updated"``, ``"deleted"``. */
  type: string
  /** Optional structured payload. */
  data?: unknown
  /** Originating tab's client id, used for echo suppression. */
  clientId?: string
  /** Server timestamp (ms) so clients can ignore stale events. */
  timestamp: number
}

type Subscriber = (event: RealtimeEvent) => void

const subscribers = new Set<Subscriber>()

export const subscribeRealtime = (subscriber: Subscriber): (() => void) => {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export const publishRealtime = (event: Omit<RealtimeEvent, 'timestamp'>): void => {
  const full: RealtimeEvent = { ...event, timestamp: Date.now() }
  for (const sub of subscribers) {
    try {
      sub(full)
    } catch (err) {
      console.error('[realtime] subscriber threw', err)
    }
  }
}
