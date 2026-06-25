import { parsePersistedRealtimeEvent, parseSequencedRealtimeEvent } from '#shared/realtimeEventLog'
import { acceptedCommandRealtimeAppendInput } from '~~/server/livePlay/acceptedCommandRealtime'
import type {
  AcceptedLivePlayRealtimePublisher,
  AcceptedLivePlayRealtimeRecorder,
} from '~~/server/livePlay/commandExecutor'

export interface AcceptedRealtimeTestHooksOptions {
  readonly clock?: () => number
  readonly initialSequence?: number
}

export const acceptedRealtimeTestHooks = (
  published: unknown[],
  options: AcceptedRealtimeTestHooksOptions = {},
): {
  readonly recordAcceptedRealtimeEvent: AcceptedLivePlayRealtimeRecorder
  readonly publishAcceptedRealtimeEvent: AcceptedLivePlayRealtimePublisher
} => {
  const clock = options.clock ?? (() => 1_000)
  let nextSequence = options.initialSequence ?? 0

  return {
    recordAcceptedRealtimeEvent: ({ command, result, clientId }) => {
      const append = acceptedCommandRealtimeAppendInput({ command, result, clientId })
      const sequence = nextSequence + 1
      nextSequence = sequence
      const event = parseSequencedRealtimeEvent({
        ...append.event,
        sequence,
        timestamp: clock(),
      })
      return parsePersistedRealtimeEvent({
        sequence,
        ...(append.dedupeKey === undefined ? {} : { dedupeKey: append.dedupeKey }),
        access: append.access,
        event,
      })
    },
    publishAcceptedRealtimeEvent: (event) => {
      published.push(event.event)
    },
  }
}
