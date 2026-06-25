import { createHash } from 'node:crypto'
import {
  createRealtimeEventMaterial,
  parsePersistedRealtimeEvent,
  parseSequencedRealtimeEvent,
  stringifyCanonicalRealtimeJson,
  type PersistedRealtimeEvent,
} from '#shared/realtimeEventLog'
import { acceptedCommandRealtimeAppendInput } from '~~/server/livePlay/acceptedCommandRealtime'
import type {
  AcceptedLivePlayRealtimePublisher,
  AcceptedLivePlayRealtimeRecorder,
  LivePlayRealtimeEventRecorder,
  PersistedLivePlayRealtimeEventPublisher,
} from '~~/server/livePlay/commandExecutor'
import type { AppendRealtimeEventInput } from '~~/server/storage/realtimeEventRepository'

export interface AcceptedRealtimeTestHooksOptions {
  readonly clock?: () => number
  readonly initialSequence?: number
}

const materialHash = (input: AppendRealtimeEventInput): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(createRealtimeEventMaterial(input), 'realtime event material'))
  .digest('hex')

export const acceptedRealtimeTestHooks = (
  published: unknown[],
  options: AcceptedRealtimeTestHooksOptions = {},
): {
  readonly recordRealtimeEvents: LivePlayRealtimeEventRecorder
  readonly recordAcceptedRealtimeEvent: AcceptedLivePlayRealtimeRecorder
  readonly publishPersistedRealtimeEvent: PersistedLivePlayRealtimeEventPublisher
  readonly publishAcceptedRealtimeEvent: AcceptedLivePlayRealtimePublisher
} => {
  const clock = options.clock ?? (() => 1_000)
  let nextSequence = options.initialSequence ?? 0
  const byDedupeKey = new Map<string, { readonly hash: string; readonly event: PersistedRealtimeEvent }>()

  const appendMany = (inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[] => {
    if (inputs.length === 0) return []
    const defaultTimestamp = inputs.some((input) => input.timestamp === undefined) ? clock() : undefined
    return inputs.map((input) => {
      const material = createRealtimeEventMaterial(input)
      const hash = materialHash(input)
      if (material.dedupeKey !== undefined) {
        const existing = byDedupeKey.get(material.dedupeKey)
        if (existing) {
          if (existing.hash === hash) return existing.event
          throw new Error(`Realtime event dedupe key ${material.dedupeKey} already exists with different event material`)
        }
      }

      const sequence = nextSequence + 1
      nextSequence = sequence
      const event = parseSequencedRealtimeEvent({
        ...material.event,
        sequence,
        timestamp: input.timestamp ?? defaultTimestamp,
      })
      const persisted = parsePersistedRealtimeEvent({
        sequence,
        ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
        access: material.access,
        event,
      })
      if (material.dedupeKey !== undefined) byDedupeKey.set(material.dedupeKey, { hash, event: persisted })
      return persisted
    })
  }

  return {
    recordRealtimeEvents: appendMany,
    recordAcceptedRealtimeEvent: ({ command, result, clientId }) => {
      const [event] = appendMany([acceptedCommandRealtimeAppendInput({ command, result, clientId })])
      if (!event) throw new Error('accepted live-play realtime event append returned no event')
      return event
    },
    publishPersistedRealtimeEvent: (event) => {
      published.push(event.event)
    },
    publishAcceptedRealtimeEvent: (event) => {
      published.push(event.event)
    },
  }
}
