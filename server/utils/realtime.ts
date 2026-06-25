/**
 * Process-local realtime coordination.
 *
 * Durable realtime delivery is authoritative from the SQLite event log. The
 * sequenced publication path below is therefore only a wake-up signal for
 * local tailers; SSE connections must re-read the row from SQLite before
 * writing it to a client.
 *
 * Transient realtime events are still process-local and unreplayed, but every
 * production publication must carry an explicit server-side access descriptor.
 */

import type { RealtimeEvent } from '#shared/realtime'
import {
  parseRealtimeEventAccess,
  parseRealtimeEventDraft,
  parseSequencedRealtimeEvent,
  type RealtimeEventAccess,
  type SequencedRealtimeEvent,
} from '#shared/realtimeEventLog'

export type { RealtimeEvent } from '#shared/realtime'
export type { RealtimeEventAccess, SequencedRealtimeEvent } from '#shared/realtimeEventLog'

export interface TransientRealtimePublicationInput {
  readonly event: Omit<RealtimeEvent, 'timestamp'>
  readonly access: RealtimeEventAccess
}

export interface ScopedTransientRealtimeEvent {
  readonly event: RealtimeEvent
  readonly access: RealtimeEventAccess
}

type LegacySubscriber = (event: RealtimeEvent) => void
type TransientSubscriber = (publication: ScopedTransientRealtimeEvent) => void
type DurableWakeupSubscriber = (sequence: number) => void

export interface RealtimeHub {
  readonly subscribeRealtime: (subscriber: LegacySubscriber) => () => void
  readonly subscribeTransientRealtime: (subscriber: TransientSubscriber) => () => void
  readonly subscribeDurableRealtimeWakeup: (subscriber: DurableWakeupSubscriber) => () => void
  readonly publishTransientRealtime: (publication: TransientRealtimePublicationInput) => void
  readonly publishSequencedRealtime: (event: SequencedRealtimeEvent) => void
}

const deliverToSubscribers = <TValue>(
  subscribers: ReadonlySet<(value: TValue) => void>,
  value: TValue,
  logLabel: string,
): void => {
  for (const sub of subscribers) {
    try {
      sub(value)
    } catch (err) {
      console.error(logLabel, err)
    }
  }
}

export const createRealtimeHub = (): RealtimeHub => {
  const legacySubscribers = new Set<LegacySubscriber>()
  const transientSubscribers = new Set<TransientSubscriber>()
  const durableWakeupSubscribers = new Set<DurableWakeupSubscriber>()

  const subscribe = <TSubscriber>(set: Set<TSubscriber>, subscriber: TSubscriber): (() => void) => {
    set.add(subscriber)
    return () => {
      set.delete(subscriber)
    }
  }

  const publishScopedTransient = (publication: ScopedTransientRealtimeEvent): void => {
    deliverToSubscribers(transientSubscribers, publication, '[realtime] transient subscriber threw')
    deliverToSubscribers(legacySubscribers, publication.event, '[realtime] legacy subscriber threw')
  }

  return {
    subscribeRealtime: (subscriber) => subscribe(legacySubscribers, subscriber),

    subscribeTransientRealtime: (subscriber) => subscribe(transientSubscribers, subscriber),

    subscribeDurableRealtimeWakeup: (subscriber) => subscribe(durableWakeupSubscribers, subscriber),

    publishTransientRealtime: (publication) => {
      const eventDraft = parseRealtimeEventDraft(publication.event)
      const access = parseRealtimeEventAccess(publication.access)
      const full: RealtimeEvent = { ...eventDraft, timestamp: Date.now() }
      publishScopedTransient({ event: full, access })
    },

    publishSequencedRealtime: (event) => {
      const sequenced = parseSequencedRealtimeEvent(event)
      deliverToSubscribers(durableWakeupSubscribers, sequenced.sequence, '[realtime] durable wake-up subscriber threw')
      // Compatibility for non-SSE tests and old in-process consumers. This is
      // not used by the SSE delivery path as an authority.
      deliverToSubscribers(legacySubscribers, sequenced, '[realtime] legacy subscriber threw')
    },
  }
}

export const defaultRealtimeHub = createRealtimeHub()

export const subscribeRealtime = (subscriber: LegacySubscriber): (() => void) =>
  defaultRealtimeHub.subscribeRealtime(subscriber)

export const subscribeTransientRealtime = (subscriber: TransientSubscriber): (() => void) =>
  defaultRealtimeHub.subscribeTransientRealtime(subscriber)

export const subscribeDurableRealtimeWakeup = (subscriber: DurableWakeupSubscriber): (() => void) =>
  defaultRealtimeHub.subscribeDurableRealtimeWakeup(subscriber)

export const publishTransientRealtime = (publication: TransientRealtimePublicationInput): void => {
  defaultRealtimeHub.publishTransientRealtime(publication)
}

/**
 * Deprecated compatibility helper for tests and legacy local callers. Production
 * code should use publishTransientRealtime({ event, access }) so authorization is
 * explicit before a transient reaches the SSE layer.
 */
export const publishRealtime = (event: Omit<RealtimeEvent, 'timestamp'>): void => {
  publishTransientRealtime({ event, access: { kind: 'gm-only' } })
}

export const publishSequencedRealtime = (event: SequencedRealtimeEvent): void => {
  defaultRealtimeHub.publishSequencedRealtime(event)
}
