import { EventEmitter } from 'node:events'
import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { mapChannel, sheetChannel, type RealtimeEvent } from '#shared/realtime'
import { parseRealtimeConnectionRequest, type RealtimeConnectionRequest } from '#shared/realtimeReplay'
import type { RealtimeEventAccess } from '#shared/realtimeEventLog'
import type { AuthRole } from '../../server/utils/auth'
import { openRealtimeSseStream } from '../../server/realtime/realtimeSseDelivery'
import { resolveRealtimeDeliveryPrincipal } from '../../server/realtime/realtimeDeliveryPrincipal'
import type { RealtimeDeliveryPrincipal } from '../../server/realtime/realtimeEventAccessPolicy'
import { createSqliteRealtimeEventAccessDependencies } from '../../server/realtime/sqliteRealtimeEventAccessAdapter'
import { createRealtimeHub } from '../../server/utils/realtime'
import type { SseRequest, SseResponse } from '../../server/utils/sseStream'
import { createRealtimeCursorStorage } from '../../src/utils/realtimeCursorStorage'
import { durableHarness, mapDoc, pokemonSheet, trainerSheet } from '../server/helpers/durableLibraryHarness'

type ServerHarness = ReturnType<typeof createAuthorisedReplayHarness>

interface FakeEventSourceMessage {
  readonly data: string
}

type TimerHandle = ReturnType<typeof setTimeout>

interface ManualTimerApi {
  readonly setTimeout: (handler: () => void, timeout: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
  readonly runAll: () => void
}

class ServerBackedEventSource {
  static instances: ServerBackedEventSource[] = []
  static connector: ((url: string, source: ServerBackedEventSource) => void) | null = null

  readonly url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  private messageHandler: ((message: FakeEventSourceMessage) => void) | null = null
  private readonly queuedMessages: string[] = []
  private closeServer: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    ServerBackedEventSource.instances.push(this)
    queueMicrotask(() => {
      if (this.closed) return
      this.onopen?.()
      if (this.closed) return
      ServerBackedEventSource.connector?.(url, this)
    })
  }

  get onmessage(): ((message: FakeEventSourceMessage) => void) | null {
    return this.messageHandler
  }

  set onmessage(handler: ((message: FakeEventSourceMessage) => void) | null) {
    this.messageHandler = handler
    this.flushQueuedMessages()
  }

  attachServerClose(closeServer: () => void): void {
    this.closeServer = closeServer
  }

  deliverSseChunk(chunk: string): void {
    for (const frame of chunk.split('\n\n')) {
      const lines = frame.split('\n')
      const dataLine = lines.find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      this.deliverMessageData(dataLine.slice('data: '.length))
    }
  }

  deliverEvent(event: RealtimeEvent): void {
    this.deliverMessageData(JSON.stringify(event))
  }

  emitTransportError(): void {
    if (this.closed) return
    this.onerror?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeServer?.()
  }

  private deliverMessageData(data: string): void {
    if (this.messageHandler) {
      this.messageHandler({ data })
      return
    }
    this.queuedMessages.push(data)
  }

  private flushQueuedMessages(): void {
    if (!this.messageHandler) return
    for (const data of this.queuedMessages.splice(0)) {
      this.messageHandler({ data })
    }
  }

  static reset(): void {
    for (const instance of ServerBackedEventSource.instances.splice(0)) instance.close()
    ServerBackedEventSource.connector = null
  }
}

class MemorySessionStorage {
  readonly items = new Map<string, string>()

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}

const createManualTimerApi = (): ManualTimerApi => {
  let nextId = 1
  const timers = new Map<TimerHandle, () => void>()
  return {
    setTimeout: (handler) => {
      const id = nextId as unknown as TimerHandle
      nextId += 1
      timers.set(id, handler)
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
    runAll: () => {
      const pending = [...timers.entries()]
      timers.clear()
      for (const [, handler] of pending) handler()
    },
  }
}

const flushAsync = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const createAuthorisedReplayHarness = () => {
  const base = durableHarness(10_000)
  const hub = createRealtimeHub()
  const accessDependencies = createSqliteRealtimeEventAccessDependencies({
    database: base.database,
    mapRepository: base.maps,
    sheetRepository: base.sheets,
  })
  return { ...base, hub, accessDependencies }
}

const appendEvent = (
  harness: ServerHarness,
  input: {
    readonly channel: string
    readonly label: string
    readonly access: RealtimeEventAccess
    readonly type?: string
  },
) => harness.realtime.append({
  event: {
    channel: input.channel,
    type: input.type ?? 'updated',
    data: { label: input.label },
  },
  access: input.access,
  timestamp: 10_000,
})

const profile = (
  id: PlayerProfileId,
  trainerSlug: string,
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id,
  displayName: trainerSlug as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})

const queryValue = (url: URL, name: string): string | readonly string[] | undefined => {
  const values = url.searchParams.getAll(name)
  if (values.length === 0) return undefined
  return values.length === 1 ? values[0] : values
}

const createSseTransport = (source: ServerBackedEventSource) => {
  const req = new EventEmitter() as EventEmitter & SseRequest
  const res: SseResponse = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      source.deliverSseChunk(chunk)
      return true
    }),
    end: vi.fn(),
  }
  source.attachServerClose(() => req.emit('close'))
  return { req, res }
}

const installServerConnector = (input: {
  readonly harness: ServerHarness
  readonly role: () => AuthRole
  readonly profiles?: ReadonlyMap<PlayerProfileId, PlayerProfile>
}): void => {
  ServerBackedEventSource.connector = (urlText, source) => {
    const url = new URL(urlText, 'http://rotom.test')
    const request = parseRealtimeConnectionRequest({
      after: queryValue(url, 'after'),
      profileId: queryValue(url, 'profileId'),
    })
    const principal = principalForRequest(input.role(), request, input.profiles ?? new Map())
    const { req, res } = createSseTransport(source)
    void openRealtimeSseStream({
      req,
      res,
      cursor: request.cursor,
      principal,
      realtimeEventRepository: input.harness.realtime,
      accessDependencies: input.harness.accessDependencies,
      realtimeHub: input.harness.hub,
      pollIntervalMs: 60_000,
      keepaliveMs: 60_000,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      connectionId: `integration-${ServerBackedEventSource.instances.length}`,
    })
  }
}

const principalForRequest = (
  role: AuthRole,
  request: RealtimeConnectionRequest,
  profiles: ReadonlyMap<PlayerProfileId, PlayerProfile>,
): RealtimeDeliveryPrincipal => resolveRealtimeDeliveryPrincipal(
  { event: {} as H3Event, role, request },
  {
    resolvePlayerProfile: (profileId) => (profileId === null ? null : profiles.get(profileId) ?? null),
    getSessionAccess: () => null,
  },
)

const loadRealtimeClient = async (timerApi = createManualTimerApi()) => {
  vi.resetModules()
  vi.stubGlobal('window', { location: { href: 'http://rotom.test/maps/arena' } })

  const context = await import('~/utils/realtimeClientPrincipalContext')
  const realtime = await import('~/composables/useRealtime')
  const storage = new MemorySessionStorage()
  const cursorStorage = createRealtimeCursorStorage({ getSessionStorage: () => storage, warn: vi.fn() })

  realtime.configureRealtimeForTests({
    eventSourceConstructor: ServerBackedEventSource,
    cursorStorage,
    timers: timerApi,
    locationHref: 'http://rotom.test/maps/arena',
  })

  return { context, realtime, cursorStorage, timerApi }
}

const waitForConnectionState = async (
  changes: readonly { readonly state: string; readonly reason: string }[],
  state: string,
  reason: string,
): Promise<void> => {
  await vi.waitFor(() => {
    expect(changes).toContainEqual(expect.objectContaining({ state, reason }))
  })
}

afterEach(() => {
  ServerBackedEventSource.reset()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('authorised durable replay end-to-end', () => {
  it('starts cursorless streams after retained history, then replays missed visible map and sheet events in sequence order', async () => {
    const harness = createAuthorisedReplayHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'arena', playerVisible: true }))
    harness.sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ slug: 'pika', player: true }))
    appendEvent(harness, {
      channel: mapChannel('arena'),
      label: 'old-history',
      access: { kind: 'map-access', mapSlug: 'arena' },
    })

    let serverRole: AuthRole = 'gm'
    installServerConnector({ harness, role: () => serverRole })
    const { context, realtime, cursorStorage, timerApi } = await loadRealtimeClient()
    context.setRealtimeClientAuthRole('gm')

    const received: RealtimeEvent[] = []
    const changes: Array<{ state: string; reason: string }> = []
    const unsubscribeConnection = realtime.subscribeRealtimeConnection((change) => changes.push(change))
    const unsubscribeMap = realtime.subscribeChannel(mapChannel('arena'), (event) => received.push(event))
    const unsubscribeSheet = realtime.subscribeChannel(sheetChannel('pokemon', 'pika'), (event) => received.push(event))

    await waitForConnectionState(changes, 'connected', 'replay-caught-up')
    expect(received).toEqual([])
    expect(cursorStorage.readCursor('gm')).toBe(1)

    const firstSource = ServerBackedEventSource.instances[0]
    firstSource?.emitTransportError()
    appendEvent(harness, {
      channel: mapChannel('arena'),
      label: 'missed-map',
      access: { kind: 'map-access', mapSlug: 'arena' },
    })
    appendEvent(harness, {
      channel: sheetChannel('pokemon', 'pika'),
      label: 'missed-sheet',
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
    })

    timerApi.runAll()
    await flushAsync()

    expect(ServerBackedEventSource.instances[1]?.url).toBe('/api/events?after=1')
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received.map((event) => event.data)).toEqual([
      { label: 'missed-map' },
      { label: 'missed-sheet' },
    ])
    expect(received.map((event) => event.sequence)).toEqual([2, 3])
    expect(cursorStorage.readCursor('gm')).toBe(3)
    expect(changes).not.toContainEqual(expect.objectContaining({ reason: 'reconcile-required' }))

    unsubscribeSheet()
    unsubscribeMap()
    unsubscribeConnection()
    serverRole = 'gm'
  })

  it('turns denied durable events into checkpoints without payload leakage or reconnect loops', async () => {
    const harness = createAuthorisedReplayHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'hidden', playerVisible: false }))
    appendEvent(harness, {
      channel: 'gm:secrets',
      label: 'gm-secret',
      access: { kind: 'gm-only' },
    })
    appendEvent(harness, {
      channel: mapChannel('hidden'),
      label: 'hidden-map-secret',
      access: { kind: 'map-access', mapSlug: 'hidden' },
    })

    installServerConnector({ harness, role: () => 'player' })
    const { context, realtime, cursorStorage, timerApi } = await loadRealtimeClient()
    context.setRealtimeClientAuthRole('player')
    cursorStorage.advanceCursor('player:none', 0)

    const received: RealtimeEvent[] = []
    const changes: Array<{ state: string; reason: string }> = []
    const unsubscribeConnection = realtime.subscribeRealtimeConnection((change) => changes.push(change))
    const unsubscribe = realtime.subscribeChannel(mapChannel('hidden'), (event) => received.push(event))

    await waitForConnectionState(changes, 'connected', 'replay-caught-up')
    expect(ServerBackedEventSource.instances[0]?.url).toBe('/api/events?after=0')
    expect(received).toEqual([])
    expect(cursorStorage.readCursor('player:none')).toBe(2)
    expect(changes).not.toContainEqual(expect.objectContaining({ reason: 'malformed-message' }))
    expect(changes).not.toContainEqual(expect.objectContaining({ reason: 'reconcile-required' }))

    ServerBackedEventSource.instances[0]?.emitTransportError()
    timerApi.runAll()
    await flushAsync()

    expect(ServerBackedEventSource.instances[1]?.url).toBe('/api/events?after=2')
    await waitForConnectionState(changes, 'connected', 'replay-caught-up')
    expect(received).toEqual([])
    expect(ServerBackedEventSource.instances).toHaveLength(2)

    unsubscribe()
    unsubscribeConnection()
  })

  it('filters replay by selected profile and ignores callbacks from the closed old-profile stream', async () => {
    const harness = createAuthorisedReplayHarness()
    const profileAsh = 'profile_ash00000' as PlayerProfileId
    const profileMisty = 'profile_misty000' as PlayerProfileId
    const profiles = new Map<PlayerProfileId, PlayerProfile>([
      [profileAsh, profile(profileAsh, 'ash')],
      [profileMisty, profile(profileMisty, 'misty')],
    ])
    harness.sheets.saveSetupSheet('trainer', 'ash', trainerSheet({ slug: 'ash', currentTeam: ['pika'], player: false }))
    harness.sheets.saveSetupSheet('trainer', 'misty', trainerSheet({ slug: 'misty', currentTeam: ['staryu'], player: false }))
    harness.sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ slug: 'pika', player: false }))
    harness.sheets.saveSetupSheet('pokemon', 'staryu', pokemonSheet({ slug: 'staryu', player: false }))
    appendEvent(harness, {
      channel: sheetChannel('pokemon', 'pika'),
      label: 'ash-visible',
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
    })
    appendEvent(harness, {
      channel: sheetChannel('pokemon', 'staryu'),
      label: 'misty-visible',
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'staryu' },
    })

    installServerConnector({ harness, role: () => 'player', profiles })
    const { context, realtime, cursorStorage } = await loadRealtimeClient()
    context.setRealtimeClientAuthRole('player')
    context.publishRealtimeSelectedPlayerProfileId(profileAsh)
    cursorStorage.advanceCursor(`player:${profileAsh}`, 0)
    cursorStorage.advanceCursor(`player:${profileMisty}`, 0)

    const received: RealtimeEvent[] = []
    const unsubscribePika = realtime.subscribeChannel(sheetChannel('pokemon', 'pika'), (event) => received.push(event))
    const unsubscribeStaryu = realtime.subscribeChannel(sheetChannel('pokemon', 'staryu'), (event) => received.push(event))

    await vi.waitFor(() => expect(received.map((event) => event.data)).toEqual([{ label: 'ash-visible' }]))
    expect(cursorStorage.readCursor(`player:${profileAsh}`)).toBe(2)
    expect(ServerBackedEventSource.instances[0]?.url).toBe(`/api/events?profileId=${profileAsh}&after=0`)

    const oldProfileSource = ServerBackedEventSource.instances[0]
    context.publishRealtimeSelectedPlayerProfileId(profileMisty)
    expect(oldProfileSource?.closed).toBe(true)
    oldProfileSource?.deliverEvent({
      channel: sheetChannel('pokemon', 'pika'),
      type: 'updated',
      sequence: 3,
      timestamp: 10_000,
      data: { label: 'late-old-profile' },
    })

    await vi.waitFor(() => expect(received.map((event) => event.data)).toEqual([
      { label: 'ash-visible' },
      { label: 'misty-visible' },
    ]))
    expect(ServerBackedEventSource.instances[1]?.url).toBe(`/api/events?profileId=${profileMisty}&after=0`)
    expect(cursorStorage.readCursor(`player:${profileMisty}`)).toBe(2)
    expect(received.map((event) => event.data)).not.toContainEqual({ label: 'late-old-profile' })

    unsubscribeStaryu()
    unsubscribePika()
  })
})
