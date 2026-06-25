import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishSequencedRealtime, subscribeRealtime } from '~~/server/utils/realtime'

const unsubscribers: Array<() => void> = []

afterEach(() => {
  while (unsubscribers.length > 0) unsubscribers.pop()?.()
  vi.restoreAllMocks()
})

describe('sequenced in-process realtime publication', () => {
  it('forwards the exact persisted event without assigning a new timestamp and isolates subscriber failures', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const received: unknown[] = []
    const event = {
      channel: 'map:arena',
      type: 'live-play-command-accepted',
      mapSlug: 'arena',
      opId: 'op_seqpub001',
      previousRevision: 1,
      revision: 2,
      patches: [],
      clientId: 'client-1',
      sequence: 42,
      timestamp: 12345,
    }

    unsubscribers.push(subscribeRealtime(() => {
      throw new Error('subscriber failed')
    }))
    unsubscribers.push(subscribeRealtime((published) => received.push(published)))

    publishSequencedRealtime(event)

    expect(received).toEqual([event])
    expect(received[0]).toBe(event)
    expect(errorSpy).toHaveBeenCalledWith('[realtime] subscriber threw', expect.any(Error))
  })
})
