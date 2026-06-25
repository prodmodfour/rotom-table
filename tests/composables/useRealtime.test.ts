import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_EVENTS_PATH, SESSION_API_PATHS } from '~/utils/apiRoutes'
import type { RealtimeEvent } from '#shared/realtime'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { RealtimeReplayCaughtUpControl, RealtimeReplayReconcileRequiredControl } from '#shared/realtimeReplay'

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

  emitOpen(): void {
    this.onopen?.()
  }

  emitRaw(data: string): void {
    this.onmessage?.({ data })
  }

  emitMessage(event: RealtimeEvent | RealtimeReplayCaughtUpControl | RealtimeReplayReconcileRequiredControl): void {
    this.emitRaw(JSON.stringify(event))
  }

  emitError(): void {
    this.onerror?.()
  }

  static reset(): void {
    FakeEventSource.instances = []
  }
}

class FakeSessionStorage {
  readonly items = new Map<string, string>()
  failReads = false
  failWrites = false

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('read failed')
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('write failed')
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}

const profileAsh = 'profile_ash00000' as PlayerProfileId
const profileMisty = 'profile_misty000' as PlayerProfileId

const installBrowserRealtimeGlobals = () => {
  FakeEventSource.reset()
  const webSocketConstructor = vi.fn()

  vi.stubGlobal('window', { location: { href: 'http://rotom.test/maps/arena' } })
  vi.stubGlobal('WebSocket', webSocketConstructor)

  return { webSocketConstructor }
}

const caughtUpControl = (
  replayedThroughSequence: number,
  requestedAfterSequence: number | null = null,
): RealtimeReplayCaughtUpControl => ({
  kind: 'realtime-control',
  type: 'replay-caught-up',
  requestedAfterSequence,
  earliestAvailableSequence: 1,
  latestSequence: Math.max(replayedThroughSequence, requestedAfterSequence ?? 0),
  replayedThroughSequence,
})

const gapControl = (): RealtimeReplayReconcileRequiredControl => ({
  kind: 'realtime-control',
  type: 'reconcile-required',
  reason: 'gap',
  requestedAfterSequence: 1,
  earliestAvailableSequence: 3,
  latestSequence: 6,
})

const aheadControl = (): RealtimeReplayReconcileRequiredControl => ({
  kind: 'realtime-control',
  type: 'reconcile-required',
  reason: 'ahead',
  requestedAfterSequence: 9,
  earliestAvailableSequence: 1,
  latestSequence: 6,
})

const sequencedEvent = (sequence: number, channel = 'maps'): RealtimeEvent => ({
  sequence,
  channel,
  type: 'updated',
  timestamp: 1000 + sequence,
  data: { sequence },
})

const loadRealtimeHarness = async () => {
  FakeEventSource.reset()
  vi.resetModules()
  const context = await import('~/utils/realtimeClientPrincipalContext')
  const cursorModule = await import('~/utils/realtimeCursorStorage')
  const realtime = await import('~/composables/useRealtime')
  const storage = new FakeSessionStorage()
  const cursorStorage = cursorModule.createRealtimeCursorStorage({
    getSessionStorage: () => storage,
    warn: vi.fn(),
  })
  realtime.configureRealtimeForTests({
    eventSourceConstructor: FakeEventSource,
    cursorStorage,
    locationHref: 'http://rotom.test/maps/arena',
  })
  return { context, realtime, cursorStorage, storage }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('useRealtime context and URL ownership', () => {
  it('keeps non-session realtime on /api/events instead of the session socket', async () => {
    const { webSocketConstructor } = installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received: RealtimeEvent[] = []

    const unsubscribe = realtime.subscribeChannel('maps', (event) => received.push(event))

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]
    expect(source?.url).toBe(API_EVENTS_PATH)
    expect(source?.url).not.toBe(SESSION_API_PATHS.socket)
    expect(webSocketConstructor).not.toHaveBeenCalled()

    source?.emitMessage(sequencedEvent(1, 'sheets'))
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

  it('builds GM URLs without a profile ID and includes a stored cursor as after', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    cursorStorage.advanceCursor('gm', 7)

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())

    expect(FakeEventSource.instances[0]?.url).toBe('/api/events?after=7')
    unsubscribe()
  })

  it('builds profiled and unprofiled player URLs with independent context cursors', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('player')
    context.publishRealtimeSelectedPlayerProfileId(profileAsh)
    cursorStorage.advanceCursor(`player:${profileAsh}`, 4)
    cursorStorage.advanceCursor('player:none', 2)

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())
    expect(FakeEventSource.instances[0]?.url).toBe(`/api/events?profileId=${profileAsh}&after=4`)

    context.publishRealtimeSelectedPlayerProfileId(null)
    expect(FakeEventSource.instances[0]?.closed).toBe(true)
    expect(FakeEventSource.instances[1]?.url).toBe('/api/events?after=2')

    context.publishRealtimeSelectedPlayerProfileId(profileMisty)
    expect(FakeEventSource.instances[1]?.closed).toBe(true)
    expect(FakeEventSource.instances[2]?.url).toBe(`/api/events?profileId=${profileMisty}`)

    unsubscribe()
  })

  it('omits after when no cursor exists and rebuilds the source on role/profile changes', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('player')
    context.publishRealtimeSelectedPlayerProfileId(null)

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())
    const first = FakeEventSource.instances[0]
    expect(first?.url).toBe(API_EVENTS_PATH)

    context.publishRealtimeSelectedPlayerProfileId(profileAsh)
    expect(first?.closed).toBe(true)
    expect(FakeEventSource.instances[1]?.url).toBe(`/api/events?profileId=${profileAsh}`)

    context.setRealtimeClientAuthRole('gm')
    expect(FakeEventSource.instances[1]?.closed).toBe(true)
    expect(FakeEventSource.instances[2]?.url).toBe(API_EVENTS_PATH)

    unsubscribe()
  })

  it('closes on logout without issuing unauthenticated SSE requests', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())
    const source = FakeEventSource.instances[0]

    context.setRealtimeClientAuthRole(null)

    expect(source?.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    unsubscribe()
  })

  it('does not create EventSource or touch storage during SSR', async () => {
    vi.stubGlobal('window', undefined)
    const { context, realtime, storage } = await loadRealtimeHarness()
    const getItem = vi.spyOn(storage, 'getItem')
    context.setRealtimeClientAuthRole('gm')

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(getItem).not.toHaveBeenCalled()
    unsubscribe()
  })
})

describe('useRealtime replay parsing and cursor handling', () => {
  it('dispatches sequenced events, advances the cursor, and survives source recreation in one tab', async () => {
    vi.useFakeTimers()
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received: RealtimeEvent[] = []

    const unsubscribe = realtime.subscribeChannel('maps', (event) => received.push(event))
    FakeEventSource.instances[0]?.emitOpen()
    FakeEventSource.instances[0]?.emitMessage(sequencedEvent(3))

    expect(received).toEqual([sequencedEvent(3)])
    expect(cursorStorage.readCursor('gm')).toBe(3)

    FakeEventSource.instances[0]?.emitError()
    await vi.advanceTimersByTimeAsync(1000)

    expect(FakeEventSource.instances[1]?.url).toBe('/api/events?after=3')
    unsubscribe()
  })

  it('dispatches transient unsequenced events without advancing the durable cursor', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received: RealtimeEvent[] = []

    const unsubscribe = realtime.subscribeChannel('maps', (event) => received.push(event))
    FakeEventSource.instances[0]?.emitMessage({ channel: 'maps', type: 'updated', timestamp: 5 })

    expect(received).toEqual([{ channel: 'maps', type: 'updated', timestamp: 5 }])
    expect(cursorStorage.readCursor('gm')).toBeNull()
    unsubscribe()
  })

  it('does not dispatch replay controls to channels', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received = vi.fn()

    const unsubscribe = realtime.subscribeChannel('maps', received)
    FakeEventSource.instances[0]?.emitMessage(caughtUpControl(0))

    expect(received).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('ignores duplicate/lower sequenced events and accepts numeric sequence jumps', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received: number[] = []

    const unsubscribe = realtime.subscribeChannel('maps', (event) => received.push(event.sequence ?? -1))
    FakeEventSource.instances[0]?.emitMessage(sequencedEvent(5))
    FakeEventSource.instances[0]?.emitMessage(sequencedEvent(5))
    FakeEventSource.instances[0]?.emitMessage(sequencedEvent(4))
    FakeEventSource.instances[0]?.emitMessage(sequencedEvent(9))

    expect(received).toEqual([5, 9])
    expect(cursorStorage.readCursor('gm')).toBe(9)
    unsubscribe()
  })

  it('rejects malformed payloads without dispatching or advancing the cursor', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const received = vi.fn()
    const changes: unknown[] = []

    realtime.subscribeRealtimeConnection((change) => changes.push(change))
    const unsubscribe = realtime.subscribeChannel('maps', received)
    const source = FakeEventSource.instances[0]
    source?.emitRaw(JSON.stringify({ ...sequencedEvent(1), access: { kind: 'gm-only' } }))

    expect(received).not.toHaveBeenCalled()
    expect(cursorStorage.readCursor('gm')).toBeNull()
    expect(source?.closed).toBe(true)
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'reconnecting',
      reason: 'malformed-message',
      error: expect.any(String),
    }))
    unsubscribe()
  })
})

describe('useRealtime connection state and replay controls', () => {
  it('does not mark connected on open; caught-up marks connected', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const changes: unknown[] = []
    realtime.subscribeRealtimeConnection((change) => changes.push(change))

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())
    const source = FakeEventSource.instances[0]
    source?.emitOpen()

    expect(changes).toEqual([
      expect.objectContaining({ state: 'connecting', previousState: 'idle', reason: 'connecting' }),
      expect.objectContaining({ state: 'replaying', previousState: 'connecting', reason: 'transport-open' }),
    ])

    source?.emitMessage(caughtUpControl(0))
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'connected',
      previousState: 'replaying',
      reason: 'replay-caught-up',
      reconnected: false,
    }))
    unsubscribe()
  })

  it('reconnects with backoff and remains replay-blocked until caught up', async () => {
    vi.useFakeTimers()
    installBrowserRealtimeGlobals()
    const { context, realtime } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const changes: unknown[] = []
    realtime.subscribeRealtimeConnection((change) => changes.push(change))

    const unsubscribe = realtime.subscribeChannel('map:pallet-town', vi.fn())
    const firstSource = FakeEventSource.instances[0]
    firstSource?.emitOpen()
    firstSource?.emitMessage(caughtUpControl(0))
    firstSource?.emitError()
    expect(firstSource?.closed).toBe(true)

    await vi.advanceTimersByTimeAsync(999)
    expect(FakeEventSource.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    const secondSource = FakeEventSource.instances[1]
    secondSource?.emitOpen()

    expect(changes).toContainEqual(expect.objectContaining({
      state: 'reconnecting',
      reason: 'transport-loss',
      reconnected: true,
    }))
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'replaying',
      reason: 'transport-open',
      reconnected: true,
    }))
    expect(changes).not.toContainEqual(expect.objectContaining({
      state: 'connected',
      reason: 'replay-caught-up',
      reconnected: true,
    }))

    secondSource?.emitMessage(caughtUpControl(0, 0))
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'connected',
      reason: 'replay-caught-up',
      reconnected: true,
    }))

    unsubscribe()
  })

  it('emits structured gap and ahead reconciliation requirements and advances to latest', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('gm')
    const changes: unknown[] = []
    realtime.subscribeRealtimeConnection((change) => changes.push(change))

    const unsubscribe = realtime.subscribeChannel('maps', vi.fn())
    FakeEventSource.instances[0]?.emitOpen()
    FakeEventSource.instances[0]?.emitMessage(gapControl())
    expect(cursorStorage.readCursor('gm')).toBe(6)
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'replaying',
      reason: 'reconcile-required',
      reconciliation: {
        reason: 'gap',
        requestedAfterSequence: 1,
        earliestAvailableSequence: 3,
        latestSequence: 6,
      },
    }))

    FakeEventSource.instances[0]?.emitMessage(aheadControl())
    expect(cursorStorage.readCursor('gm')).toBe(6)
    expect(changes).toContainEqual(expect.objectContaining({
      state: 'replaying',
      reason: 'reconcile-required',
      reconciliation: {
        reason: 'ahead',
        requestedAfterSequence: 9,
        earliestAvailableSequence: 1,
        latestSequence: 6,
      },
    }))

    unsubscribe()
  })

  it('ignores delayed callbacks from an old profile generation', async () => {
    installBrowserRealtimeGlobals()
    const { context, realtime, cursorStorage } = await loadRealtimeHarness()
    context.setRealtimeClientAuthRole('player')
    context.publishRealtimeSelectedPlayerProfileId(profileAsh)
    const received: RealtimeEvent[] = []

    const unsubscribe = realtime.subscribeChannel('maps', (event) => received.push(event))
    const oldSource = FakeEventSource.instances[0]

    context.publishRealtimeSelectedPlayerProfileId(profileMisty)
    expect(oldSource?.closed).toBe(true)
    oldSource?.emitMessage(sequencedEvent(4))
    oldSource?.emitMessage(caughtUpControl(4))

    expect(received).toEqual([])
    expect(cursorStorage.readCursor(`player:${profileAsh}`)).toBeNull()
    expect(cursorStorage.readCursor(`player:${profileMisty}`)).toBeNull()

    FakeEventSource.instances[1]?.emitMessage(sequencedEvent(5))
    expect(received).toEqual([sequencedEvent(5)])
    expect(cursorStorage.readCursor(`player:${profileMisty}`)).toBe(5)

    unsubscribe()
  })
})
