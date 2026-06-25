import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { publishSequencedRealtime } from '../utils/realtime'

export interface PersistedRealtimePublicationFailureContext {
  readonly event: PersistedRealtimeEvent
  readonly sequence: number
  readonly channel: string
  readonly type: string
  readonly operation: string
  readonly error: unknown
}

export type PersistedRealtimeEventPublisher = (event: PersistedRealtimeEvent) => void

export type PersistedRealtimePublicationFailureReporter = (
  context: PersistedRealtimePublicationFailureContext,
) => void

export const defaultPersistedRealtimeEventPublisher: PersistedRealtimeEventPublisher = (record) => {
  publishSequencedRealtime(record.event)
}

export const defaultPersistedRealtimePublicationFailureReporter: PersistedRealtimePublicationFailureReporter = (context) => {
  console.error('[realtime] persisted event publication failed', {
    operation: context.operation,
    sequence: context.sequence,
    channel: context.channel,
    type: context.type,
    error: context.error,
  })
}

export const publishPersistedRealtimeEventsAfterCommit = (input: {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly operation: string
  readonly publish: PersistedRealtimeEventPublisher
  readonly reportFailure: PersistedRealtimePublicationFailureReporter
}): void => {
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence)
  for (const event of events) {
    try {
      input.publish(event)
    } catch (error) {
      input.reportFailure({
        event,
        sequence: event.sequence,
        channel: event.event.channel,
        type: event.event.type,
        operation: input.operation,
        error,
      })
    }
  }
}
