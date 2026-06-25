import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { publishSequencedRealtime } from '../utils/realtime'

export type SetupSaveRealtimeResourceIdentity =
  | {
      readonly kind: 'map'
      readonly mapSlug: string
    }
  | {
      readonly kind: 'sheet'
      readonly sheetKind: string
      readonly sheetSlug: string
    }

export interface SetupSaveRealtimePublicationFailureContext {
  readonly event: PersistedRealtimeEvent
  readonly sequence: number
  readonly channel: string
  readonly type: string
  readonly resource: SetupSaveRealtimeResourceIdentity
  readonly error: unknown
}

export type PersistedSetupSaveRealtimeEventPublisher = (event: PersistedRealtimeEvent) => void

export type SetupSaveRealtimePublicationFailureReporter = (
  context: SetupSaveRealtimePublicationFailureContext,
) => void

export const defaultPersistedSetupSaveRealtimeEventPublisher: PersistedSetupSaveRealtimeEventPublisher = (record) => {
  publishSequencedRealtime(record.event)
}

export const defaultSetupSaveRealtimePublicationFailureReporter: SetupSaveRealtimePublicationFailureReporter = (context) => {
  console.error('[realtime] setup-save persisted event publication failed', {
    sequence: context.sequence,
    channel: context.channel,
    type: context.type,
    resource: context.resource,
    error: context.error,
  })
}

export const publishPersistedSetupSaveRealtimeEventsAfterCommit = (input: {
  readonly events: readonly PersistedRealtimeEvent[]
  readonly resource: SetupSaveRealtimeResourceIdentity
  readonly publish: PersistedSetupSaveRealtimeEventPublisher
  readonly reportFailure: SetupSaveRealtimePublicationFailureReporter
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
        resource: input.resource,
        error,
      })
    }
  }
}
