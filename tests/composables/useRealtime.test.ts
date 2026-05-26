import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_EVENTS_PATH, SESSION_API_PATHS } from '~/utils/apiRoutes'
import type { RealtimeEvent } from '#shared/realtime'

interface FakeEventSourceMessage {
  readonly data: string
}

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  onopen: (() => void) | null = null
  onmessage: ((message: FakeEventSourceMessage) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  emitMessage(event: RealtimeEvent | string): void {
    const data = typeof event === 'string' ? event : JSON.stringify(event)
    this.onmessage?.({ data })
  }

  emitError(): void {
    this.onerror?.()
  }

  static reset(): void {
    FakeEventSource.instances = []
  }
}

const installBrowserRealtimeGlobals = () => {
  FakeEventSource.reset()
  const webSocketConstructor = vi.fn()

  vi.stubGlobal('window', {})
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('WebSocket', webSocketConstructor)

  return { webSocketConstructor }
}

const loadRealtimeModule = async () => {
  vi.resetModules()
  return await import('~/composables/useRealtime')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('useRealtime legacy SSE transport', () => {
  it('keeps non-session realtime on /api/events instead of the session WebSocket', async () => {
    const { webSocketConstructor } = installBrowserRealtimeGlobals()
    const { subscribeChannel } = await loadRealtimeModule()
    const received: RealtimeEvent[] = []

    const unsubscribe = subscribeChannel('maps', (event) => received.push(event))

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe(API_EVENTS_PATH)
    expect(source?.url).not.toBe(SESSION_API_PATHS.socket)
    expect(webSocketConstructor).not.toHaveBeenCalled()

    source?.emitMessage({ channel: 'sheets', type: 'updated', timestamp: 1 })
    source?.emitMessage({
      channel: 'maps',
      type: 'updated',
      data: { slug: 'pallet-town' },
      clientId: 'client-local-tab',
      timestamp: 2,
    })

    expect(received).toEqual([
      {
        channel: 'maps',
        type: 'updated',
        data: { slug: 'pallet-town' },
        clientId: 'client-local-tab',
        timestamp: 2,
      },
    ])
    expect(webSocketConstructor).not.toHaveBeenCalled()

    unsubscribe()
    expect(source?.closed).toBe(true)
  })

  it('reconnects the legacy SSE stream while local subscribers remain active', async () => {
    vi.useFakeTimers()
    installBrowserRealtimeGlobals()
    const { subscribeChannel } = await loadRealtimeModule()

    const unsubscribe = subscribeChannel('map:pallet-town', vi.fn())
    const firstSource = FakeEventSource.instances[0]
    expect(firstSource?.url).toBe(API_EVENTS_PATH)

    firstSource?.emitError()
    expect(firstSource?.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(FakeEventSource.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    const secondSource = FakeEventSource.instances[1]
    expect(secondSource?.url).toBe(API_EVENTS_PATH)

    unsubscribe()
    expect(secondSource?.closed).toBe(true)
  })
})
