import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { computed, effectScope, ref, type EffectScope, type Ref } from 'vue'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import type { LivePlayAcceptedRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { parseRealtimeConnectionRequest, type RealtimeConnectionRequest } from '#shared/realtimeReplay'
import type { RealtimeEventAccess, RealtimeEventDraft, SequencedRealtimeEvent } from '#shared/realtimeEventLog'
import type { AuthRole } from '#shared/auth'
import { openRealtimeSseStream } from '../../server/realtime/realtimeSseDelivery'
import { resolveRealtimeDeliveryPrincipal } from '../../server/realtime/realtimeDeliveryPrincipal'
import type { RealtimeDeliveryPrincipal } from '../../server/realtime/realtimeEventAccessPolicy'
import { createSqliteRealtimeEventAccessDependencies } from '../../server/realtime/sqliteRealtimeEventAccessAdapter'
import { acceptedCommandRealtimeAppendInput } from '../../server/livePlay/acceptedCommandRealtime'
import { createAuthoritativeLivePlayCommandExecutor } from '../../server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '../../server/livePlay/mapWriteQueue'
import { createRealtimeHub, type RealtimeHub } from '../../server/utils/realtime'
import type { SseRequest, SseResponse } from '../../server/utils/sseStream'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository } from '../../server/storage/opRepository'
import { createSqliteMapRepository, type MapRepository } from '../../server/storage/mapRepository'
import { createSqliteMapInteractionModeRepository, type MapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../../server/storage/sheetRepository'
import { executeMapTokenLivePlayCommandUseCase } from '../../server/useCases/applyMapTokenAction'
import { executeLivePlaySheetCommandUseCase } from '../../server/useCases/applyLivePlaySheetCommand'
import { executeLivePlayInitiativeCommandUseCase } from '../../server/useCases/applyLivePlayInitiativeCommand'
import { executeLivePlayMapEffectsCommandUseCase } from '../../server/useCases/applyLivePlayMapEffectsCommand'
import { executeLivePlaySceneCommandUseCase } from '../../server/useCases/applyLivePlaySceneCommand'
import { getLivePlayOperationStatusUseCase } from '../../server/useCases/getLivePlayOperationStatus'
import { abandonLivePlayOperationUseCase } from '../../server/useCases/abandonLivePlayOperation'
import { loadLiveTableSnapshotUseCase } from '../../server/useCases/loadLiveTableSnapshot'
import { setMapInteractionModeUseCase } from '../../server/useCases/setMapInteractionMode'
import { saveMapUseCase } from '../../server/useCases/saveMap'
import { createRealtimeCursorStorage, type RealtimeCursorStorage } from '../../src/utils/realtimeCursorStorage'
import { createLivePlayCommandOutbox, type LivePlayCommandOutbox } from '../../src/utils/livePlayCommandOutbox'
import type { LivePlayCommandSheetUpdate } from '../../src/composables/map-editor/useLivePlayCommands'
import type { LiveSheetAccessScopeKey } from '../../src/utils/liveSheetCache'
import type { ApiGetOptions } from '../../src/utils/apiClient'
import { MAP_API_PATHS, SHEET_API_PATHS } from '../../src/utils/apiRoutes'
import { deepCloneJson } from '../../src/utils/serialization'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TabletopMap } from '../../src/types/map'
import type { TrainerSheet } from '../../src/types/trainerSheet'

type UnknownRecord = Record<string, unknown>
type TimerHandle = ReturnType<typeof setTimeout>

export interface ManualTimerApi {
  readonly setTimeout: (handler: () => void, timeout: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
  readonly pendingCount: () => number
  readonly runNext: () => void
  readonly runAll: () => void
}

export class MemorySessionStorage {
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

export const createManualTimerApi = (): ManualTimerApi => {
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
    pendingCount: () => timers.size,
    runNext: () => {
      const [entry] = timers.entries()
      if (!entry) return
      const [id, handler] = entry
      timers.delete(id)
      handler()
    },
    runAll: () => {
      const pending = [...timers.entries()]
      timers.clear()
      for (const [, handler] of pending) handler()
    },
  }
}

export const flushAsync = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

export const deferred = <TValue>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const cloneJson = <TValue>(value: TValue): TValue => deepCloneJson(value)

export const chaosMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'chaos-arena',
  name: 'Chaos Arena',
  folder: '',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass', color: '#66aa66' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-alpha',
      sheetKind: 'pokemon',
      sheetSlug: 'alpha-mon',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 12,
    },
    {
      id: 'token-beta',
      sheetKind: 'pokemon',
      sheetSlug: 'beta-mon',
      position: { x: 2, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 9,
    },
  ],
  lights: [],
  initiative: { activeId: 'token-alpha', round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

export const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> & UnknownRecord = {},
): CharacterSheet => ({
  slug,
  species: slug === 'alpha-mon' ? 'Pikachu' : slug === 'beta-mon' ? 'Eevee' : slug,
  nickname: slug,
  level: 20,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  combat: { currentHp: 30, injuries: 0, conditions: [] },
  stats: {
    atk: { stage: 0 },
    def: { stage: 0 },
    satk: { stage: 0 },
    sdef: { stage: 0 },
    spd: { stage: 0 },
  },
  combatStages: { acc: 0 },
  movelist: [],
  ...overrides,
} as unknown as CharacterSheet)

export const trainerSheet = (
  slug: string,
  currentTeam: readonly string[],
  overrides: Partial<TrainerSheet> & UnknownRecord = {},
): TrainerSheet => ({
  slug,
  name: slug,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  currentTeam: [...currentTeam],
  pokemon: [...currentTeam],
  inventory: [],
  ...overrides,
} as unknown as TrainerSheet)

export const playerProfile = (
  id: PlayerProfileId,
  trainerSlug: string,
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id,
  displayName: trainerSlug as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})

export class HarnessEventSource {
  readonly url: string
  readonly label: string
  onopen: (() => void) | null = null
  onmessage: ((message: { readonly data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  readonly deliveredData: string[] = []

  private readonly queuedMessages: string[] = []
  private closeServer: (() => void) | null = null

  constructor(
    url: string,
    label: string,
    connect: (source: HarnessEventSource) => void,
  ) {
    this.url = url
    this.label = label
    queueMicrotask(() => {
      if (this.closed) return
      this.onopen?.()
      if (this.closed) return
      connect(this)
    })
  }

  attachServerClose(closeServer: () => void): void {
    this.closeServer = closeServer
  }

  deliverSseChunk(chunk: string): void {
    for (const frame of chunk.split('\n\n')) {
      if (!frame.trim()) continue
      const dataLines = frame.split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
      if (dataLines.length === 0) continue
      this.deliverMessageData(dataLines.join('\n'))
    }
  }

  deliverRawData(data: string): void {
    this.deliverMessageData(data)
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
    this.deliveredData.push(data)
    if (this.onmessage) {
      this.onmessage({ data })
      return
    }
    this.queuedMessages.push(data)
  }

  flushQueuedMessages(): void {
    if (!this.onmessage) return
    for (const data of this.queuedMessages.splice(0)) this.onmessage({ data })
  }
}

const queryValue = (url: URL, name: string): string | readonly string[] | undefined => {
  const values = url.searchParams.getAll(name)
  if (values.length === 0) return undefined
  return values.length === 1 ? values[0] : values
}

const createSseTransport = (source: HarnessEventSource) => {
  const req = new EventEmitter() as EventEmitter & SseRequest
  const res: SseResponse = {
    setHeader: () => undefined,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      source.deliverSseChunk(chunk)
      return true
    },
    end: () => undefined,
  }
  source.attachServerClose(() => req.emit('close'))
  return { req, res }
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

interface ServerInstance {
  readonly name: string
  readonly hub: RealtimeHub
  publishLocalWakeups: boolean
}

export interface ChaosHarnessOptions {
  readonly map?: TabletopMap
  readonly mode?: MapInteractionMode
}

export class FullSystemChaosHarness {
  readonly tempRoot: string
  readonly database: RotomDatabase
  readonly maps: MapRepository<TabletopMap>
  readonly sheets: SheetRepository<Record<string, unknown>>
  readonly modes: MapInteractionModeRepository
  readonly realtime: RealtimeEventRepository
  readonly ops: LivePlayOpRepository
  readonly queue = createInProcessMapWriteQueue()
  readonly indexedDBFactory = new FakeIDBFactory() as unknown as IDBFactory
  readonly serverA: ServerInstance = { name: 'A', hub: createRealtimeHub(), publishLocalWakeups: true }
  readonly serverB: ServerInstance = { name: 'B', hub: createRealtimeHub(), publishLocalWakeups: true }
  readonly profiles = new Map<PlayerProfileId, PlayerProfile>()
  readonly sources: HarnessEventSource[] = []

  private readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  private nowValue = 1_700_000_100_000
  private disposed = false

  constructor(options: ChaosHarnessOptions = {}) {
    this.tempRoot = mkdtempSync(join(tmpdir(), 'rotom-live-play-chaos-'))
    this.database = openRotomDatabase({ path: join(this.tempRoot, 'campaign.sqlite') })
    this.maps = createSqliteMapRepository<TabletopMap>(this.database)
    this.sheets = createSqliteSheetRepository<Record<string, unknown>>(this.database)
    this.modes = createSqliteMapInteractionModeRepository(this.database)
    this.realtime = createSqliteRealtimeEventRepository({ database: this.database, clock: () => this.nextTimestamp() })
    this.ops = createSqliteLivePlayOpRepository({ database: this.database, clock: () => this.nextTimestamp() })
    this.commandExecutor = createAuthoritativeLivePlayCommandExecutor({
      opStore: this.ops,
      queue: this.queue,
      readMapInteractionMode: (mapSlug) => this.modes.get(mapSlug).interactionMode,
      recordRealtimeEvents: (inputs) => this.realtime.appendMany(inputs),
      recordAcceptedRealtimeEvent: ({ command, result, clientId }) => {
        const [event] = this.realtime.appendMany([
          acceptedCommandRealtimeAppendInput({ command, result, clientId }),
        ])
        if (!event) throw new Error('accepted realtime append returned no event')
        return event
      },
      publishPersistedRealtimeEvent: (event) => {
        if (this.serverA.publishLocalWakeups) this.serverA.hub.publishSequencedRealtime(event.event)
      },
    })

    this.seed(options)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const source of this.sources.splice(0)) source.close()
    this.database.close()
    rmSync(this.tempRoot, { recursive: true, force: true })
  }

  nextTimestamp(): number {
    this.nowValue += 1
    return this.nowValue
  }

  addProfile(profile: PlayerProfile): void {
    this.profiles.set(profile.id, profile)
  }

  seed(options: ChaosHarnessOptions): void {
    const map = options.map ?? chaosMap()
    this.maps.save({
      slug: map.slug,
      document: map,
      revision: map.revision ?? 0,
      updatedAt: map.updatedAt ?? this.nextTimestamp(),
    })
    this.modes.set({
      slug: map.slug,
      interactionMode: options.mode ?? MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: this.nextTimestamp(),
    })

    for (const sheet of [
      { kind: 'pokemon', slug: 'alpha-mon', sheet: pokemonSheet('alpha-mon') },
      { kind: 'pokemon', slug: 'beta-mon', sheet: pokemonSheet('beta-mon') },
      { kind: 'pokemon', slug: 'staryu', sheet: pokemonSheet('staryu') },
      { kind: 'trainer', slug: 'ash', sheet: trainerSheet('ash', ['alpha-mon']) },
      { kind: 'trainer', slug: 'misty', sheet: trainerSheet('misty', ['staryu']) },
    ] as const) {
      this.sheets.save({
        kind: sheet.kind,
        slug: sheet.slug,
        document: sheet.sheet as unknown as Record<string, unknown>,
        revision: 0,
        updatedAt: this.nextTimestamp(),
      })
    }

    this.addProfile(playerProfile('profile_ash00000' as PlayerProfileId, 'ash'))
    this.addProfile(playerProfile('profile_misty000' as PlayerProfileId, 'misty'))
  }

  readMap(slug = 'chaos-arena'): TabletopMap {
    const stored = this.maps.get(slug)
    if (!stored) throw new Error(`Map ${slug} was not found`)
    return cloneJson(stored.document as unknown as TabletopMap)
  }

  readSheet(kind: 'pokemon' | 'trainer', slug: string): PersistedSheet {
    const stored = this.sheets.getByRef(kind, slug)
    if (!stored) throw new Error(`${kind} sheet ${slug} was not found`)
    return cloneJson(stored)
  }

  appendEvent(input: {
    readonly event: RealtimeEventDraft
    readonly access: RealtimeEventAccess
    readonly server?: ServerInstance
  }): SequencedRealtimeEvent {
    const persisted = this.realtime.append({ ...input, timestamp: this.nextTimestamp() })
    if ((input.server ?? this.serverA).publishLocalWakeups) (input.server ?? this.serverA).hub.publishSequencedRealtime(persisted.event)
    return persisted.event
  }

  pruneRealtimeThrough(sequence: number): void {
    this.realtime.pruneThrough(sequence)
  }

  openSseStream(input: {
    readonly source: HarnessEventSource
    readonly urlText: string
    readonly role: AuthRole
    readonly server?: ServerInstance
  }): void {
    const server = input.server ?? this.serverA
    const url = new URL(input.urlText, 'http://rotom.test')
    const request = parseRealtimeConnectionRequest({
      after: queryValue(url, 'after'),
      profileId: queryValue(url, 'profileId'),
    })
    const principal = principalForRequest(input.role, request, this.profiles)
    const { req, res } = createSseTransport(input.source)
    void openRealtimeSseStream({
      req,
      res,
      cursor: request.cursor,
      principal,
      realtimeEventRepository: this.realtime,
      accessDependencies: createSqliteRealtimeEventAccessDependencies({
        database: this.database,
        mapRepository: this.maps,
        sheetRepository: this.sheets,
      }),
      realtimeHub: server.hub,
      pollIntervalMs: 100,
      keepaliveMs: 60_000,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      connectionId: `${server.name}-${this.sources.length}`,
      connectionLabel: input.source.label,
    })
  }

  createEventSourceConstructor(input: {
    readonly label: string
    readonly role: Ref<AuthRole>
    readonly server?: ServerInstance
  }) {
    const harness = this
    return class ClientEventSource extends HarnessEventSource {
      constructor(url: string) {
        super(url, input.label, (source) => {
          harness.openSseStream({
            source,
            urlText: url,
            role: input.role.value,
            server: input.server,
          })
        })
        harness.sources.push(this)
      }
    }
  }

  async apiGet(path: string, options: ApiGetOptions = {}, role: AuthRole, profileId: PlayerProfileId | null): Promise<unknown> {
    if (path === MAP_API_PATHS.liveState) {
      return loadLiveTableSnapshotUseCase({
        role,
        slug: options.params?.slug,
        playerProfile: role === 'player' && profileId ? this.profiles.get(profileId) ?? null : null,
        sessionAccess: null,
      }, {
        database: this.database,
        mapRepository: this.maps,
        modeRepository: this.modes,
        sheetRepository: this.sheets,
      })
    }

    if (path === SHEET_API_PATHS.list) {
      const snapshot = loadLiveTableSnapshotUseCase({
        role,
        slug: 'chaos-arena',
        playerProfile: role === 'player' && profileId ? this.profiles.get(profileId) ?? null : null,
        sessionAccess: null,
      }, {
        database: this.database,
        mapRepository: this.maps,
        modeRepository: this.modes,
        sheetRepository: this.sheets,
      })
      return { pokemonSheets: snapshot.pokemonSheets, trainerSheets: snapshot.trainerSheets }
    }

    throw new Error(`Unhandled GET ${path}`)
  }

  async apiPost(path: string, body: unknown, role: AuthRole, profileId: PlayerProfileId | null): Promise<unknown> {
    if (path === MAP_API_PATHS.interactionMode) {
      const record = body as UnknownRecord
      return setMapInteractionModeUseCase({
        slug: String(record.slug),
        interactionMode: record.interactionMode as MapInteractionMode,
        clientId: typeof record.clientId === 'string' ? record.clientId : undefined,
      }, {
        database: this.database,
        modeRepository: this.modes,
        mapRepository: this.maps,
        realtimeEventRepository: this.realtime,
        publishPersistedRealtimeEvent: (event) => this.serverA.hub.publishSequencedRealtime(event.event),
        now: () => this.nextTimestamp(),
      })
    }

    if (path === MAP_API_PATHS.save) {
      const record = body as UnknownRecord
      return saveMapUseCase({
        role,
        slug: String(record.slug),
        map: record.map as TabletopMap,
        expectedRevision: Number(record.expectedRevision),
        clientId: typeof record.clientId === 'string' ? record.clientId : undefined,
        interactionMode: record.interactionMode as MapInteractionMode,
      }, {
        database: this.database,
        mapRepository: this.maps,
        realtimeEventRepository: this.realtime,
        publishPersistedRealtimeEvent: (event) => this.serverA.hub.publishSequencedRealtime(event.event),
        now: () => this.nextTimestamp(),
      })
    }

    if (path === MAP_API_PATHS.operationStatus) {
      const command = (body as UnknownRecord).command
      return getLivePlayOperationStatusUseCase({
        role,
        command,
        playerProfile: role === 'player' && profileId ? this.profiles.get(profileId) ?? null : null,
      }, {
        mapRepository: this.maps,
        operationStore: this.ops,
      })
    }

    if (path === MAP_API_PATHS.operationAbandon) {
      const command = (body as UnknownRecord).command
      return abandonLivePlayOperationUseCase({
        role,
        command,
        playerProfile: role === 'player' && profileId ? this.profiles.get(profileId) ?? null : null,
      }, {
        database: this.database,
        mapRepository: this.maps,
        operationStore: this.ops,
        queue: this.queue,
      })
    }

    return this.toRouteCommandResponse(await this.executeCommandPath(path, body as LivePlayCommandEnvelope, role, profileId))
  }

  private toRouteCommandResponse(response: unknown): unknown {
    if (!response || typeof response !== 'object' || Array.isArray(response)) return response
    const record = response as UnknownRecord
    const result = record.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) return response
    if ((result as UnknownRecord).ok !== true) return result
    return {
      ...(result as UnknownRecord),
      ...(record.path === undefined ? {} : { path: record.path }),
      ...(record.map === undefined ? {} : { map: record.map }),
      ...(record.placement === undefined ? {} : { placement: record.placement }),
      ...(record.sheetUpdates === undefined ? {} : { sheetUpdates: record.sheetUpdates }),
      ...(record.capture === undefined ? {} : { capture: record.capture }),
      ...(record.move === undefined ? {} : { move: record.move }),
    }
  }

  executeCommandPath(
    path: string,
    command: LivePlayCommandEnvelope,
    role: AuthRole,
    profileId: PlayerProfileId | null,
  ): Promise<unknown> {
    const commandRecord = command as unknown as UnknownRecord
    const actor = {
      role,
      clientId: typeof commandRecord.clientId === 'string' ? String(commandRecord.clientId) : 'test-client',
      playerProfile: role === 'player' && profileId ? this.profiles.get(profileId) ?? null : null,
    }
    const deps = this.commandDependencies()

    if (path === MAP_API_PATHS.moveToken) {
      return executeMapTokenLivePlayCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        playerProfile: actor.playerProfile,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      }, deps)
    }
    if (path === MAP_API_PATHS.turnToken) {
      return executeMapTokenLivePlayCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        playerProfile: actor.playerProfile,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      }, deps)
    }
    if (path === MAP_API_PATHS.modifyHp) {
      return executeLivePlaySheetCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        playerProfile: actor.playerProfile,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      }, deps)
    }
    if (path === MAP_API_PATHS.nextInitiative) {
      return executeLivePlayInitiativeCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      }, deps)
    }
    if (path === MAP_API_PATHS.setFieldEffect) {
      return executeLivePlayMapEffectsCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      }, deps)
    }
    if (path === MAP_API_PATHS.setScene) {
      return executeLivePlaySceneCommandUseCase({
        role: actor.role,
        clientId: actor.clientId,
        command,
        expectedType: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      }, deps)
    }

    throw new Error(`Unhandled POST command path ${path}`)
  }

  moveTokenCommand(input: {
    readonly opId?: string
    readonly baseRevision: number
    readonly placementId?: string
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly clientId?: string
  }): LivePlayCommandEnvelope {
    const placementId = input.placementId ?? 'token-alpha'
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId ?? createLivePlayOpId(),
      mapSlug: 'chaos-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId, field: 'position' }],
      payload: { placementId, position: input.position },
      ...(input.clientId ? { clientId: input.clientId } : {}),
    } as LivePlayCommandEnvelope
  }

  modifyHpCommand(input: {
    readonly opId?: string
    readonly baseRevision: number
    readonly placementId?: string
    readonly currentHp: number
    readonly clientId?: string
  }): LivePlayCommandEnvelope {
    const placementId = input.placementId ?? 'token-alpha'
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId ?? createLivePlayOpId(),
      mapSlug: 'chaos-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [
        { kind: 'token', placementId, field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'alpha-mon', field: 'hp' },
      ],
      payload: { placementId, currentHp: input.currentHp },
      ...(input.clientId ? { clientId: input.clientId } : {}),
    } as LivePlayCommandEnvelope
  }

  private commandDependencies() {
    return {
      commandExecutor: this.commandExecutor,
      mapRepository: this.maps,
      sheetRepository: this.sheets,
      database: this.database,
      relativePath: (path: string) => path,
      now: () => this.nextTimestamp(),
    }
  }
}

export interface ClientTabApiHandler {
  readonly getJson: (path: string, options?: ApiGetOptions) => Promise<unknown>
  readonly postJson: (path: string, body: unknown) => Promise<unknown>
}

export interface ClientRuntimeModules {
  readonly context: typeof import('../../src/utils/realtimeClientPrincipalContext')
  readonly apiClientModule: typeof import('../../src/composables/useApiClient')
  readonly realtime: typeof import('../../src/composables/useRealtime')
  readonly liveSheetsModule: typeof import('../../src/composables/useLiveSheets')
  readonly editableMapModule: typeof import('../../src/composables/useEditableMap')
  readonly snapshotModule: typeof import('../../src/composables/map-editor/useLiveTableSnapshotSync')
  readonly modeModule: typeof import('../../src/composables/map-editor/useSharedMapInteractionMode')
  readonly commandsModule: typeof import('../../src/composables/map-editor/useLivePlayCommands')
  readonly stateMachineModule: typeof import('../../src/composables/map-editor/useLivePlayStateMachine')
  readonly recoveryGateModule: typeof import('../../src/composables/map-editor/useLivePlayCommandRecoveryGate')
}

export interface ClientTabOptions {
  readonly label: string
  readonly harness: FullSystemChaosHarness
  readonly api: ClientTabApiHandler
  readonly role?: AuthRole
  readonly profileId?: PlayerProfileId | null
  readonly server?: ServerInstance
  readonly databaseName?: string
}

export class ClientTab {
  readonly label: string
  readonly harness: FullSystemChaosHarness
  readonly api: ClientTabApiHandler
  readonly role: Ref<AuthRole>
  readonly selectedProfileId: Ref<PlayerProfileId | null>
  readonly timers = createManualTimerApi()
  readonly sessionStorage = new MemorySessionStorage()
  readonly cursorStorage: RealtimeCursorStorage
  readonly outbox: LivePlayCommandOutbox
  readonly scope: EffectScope
  readonly modules: ClientRuntimeModules
  readonly connectionChanges: Array<import('../../src/composables/useRealtime').RealtimeConnectionChange> = []
  readonly presentationEvents: string[] = []

  map!: ReturnType<ClientRuntimeModules['editableMapModule']['useEditableMap']>
  liveSheets!: ReturnType<ClientRuntimeModules['liveSheetsModule']['useLiveSheets']>
  snapshot!: ReturnType<ClientRuntimeModules['snapshotModule']['useLiveTableSnapshotSync']>
  mode!: ReturnType<ClientRuntimeModules['modeModule']['useSharedMapInteractionMode']>
  commands!: ReturnType<ClientRuntimeModules['commandsModule']['useLivePlayCommands']>
  recoveryGate!: ReturnType<ClientRuntimeModules['recoveryGateModule']['useLivePlayCommandRecoveryGate']>
  readiness!: Ref<boolean>

  private removeConnection: (() => void) | null = null

  private constructor(options: ClientTabOptions & { modules: ClientRuntimeModules }) {
    this.label = options.label
    this.harness = options.harness
    this.api = options.api
    this.modules = options.modules
    this.role = ref(options.role ?? 'gm')
    this.selectedProfileId = ref(options.profileId ?? null)
    this.cursorStorage = createRealtimeCursorStorage({
      getSessionStorage: () => this.sessionStorage,
      warn: () => undefined,
    })
    this.outbox = createLivePlayCommandOutbox({
      databaseName: options.databaseName ?? 'chaos-shared-outbox',
      indexedDBFactory: options.harness.indexedDBFactory,
    })
    this.scope = effectScope()
    this.modules.apiClientModule.configureApiClientForTests({
      getJson: async <T = unknown>(path: string, apiOptions?: ApiGetOptions): Promise<T> => (
        await this.api.getJson(path, apiOptions) as T
      ),
      postJson: async <T = unknown>(path: string, body: unknown): Promise<T> => (
        await this.api.postJson(path, body) as T
      ),
    })

    const EventSourceConstructor = options.harness.createEventSourceConstructor({
      label: options.label,
      role: this.role,
      server: options.server,
    })
    this.modules.realtime.configureRealtimeForTests({
      eventSourceConstructor: EventSourceConstructor,
      timers: this.timers,
      cursorStorage: this.cursorStorage,
      locationHref: 'http://rotom.test/maps/chaos-arena',
    })
    this.modules.context.setRealtimeClientAuthRole(this.role.value)
    this.modules.context.publishRealtimeSelectedPlayerProfileId(this.selectedProfileId.value)

    this.scope.run(() => this.setupRuntime())
  }

  static async create(options: ClientTabOptions): Promise<ClientTab> {
    const modules: ClientRuntimeModules = {
      context: await import('../../src/utils/realtimeClientPrincipalContext'),
      apiClientModule: await import('../../src/composables/useApiClient'),
      realtime: await import('../../src/composables/useRealtime'),
      liveSheetsModule: await import('../../src/composables/useLiveSheets'),
      editableMapModule: await import('../../src/composables/useEditableMap'),
      snapshotModule: await import('../../src/composables/map-editor/useLiveTableSnapshotSync'),
      modeModule: await import('../../src/composables/map-editor/useSharedMapInteractionMode'),
      commandsModule: await import('../../src/composables/map-editor/useLivePlayCommands'),
      stateMachineModule: await import('../../src/composables/map-editor/useLivePlayStateMachine'),
      recoveryGateModule: await import('../../src/composables/map-editor/useLivePlayCommandRecoveryGate'),
    }
    return new ClientTab({ ...options, modules })
  }

  get latestSource(): HarnessEventSource | undefined {
    return [...this.harness.sources].reverse().find((source) => source.label === this.label)
  }

  get currentMap(): TabletopMap | null {
    return this.map.map.value
  }

  get pokemonSheets(): Map<string, CharacterSheet> {
    return this.liveSheets.pokemonBySlug.value
  }

  get trainerSheets(): Map<string, TrainerSheet> {
    return this.liveSheets.trainerBySlug.value
  }

  async hydrate(reason = 'Loading initial live table snapshot.'): Promise<void> {
    await this.snapshot.requestSnapshot(reason)
  }

  async switchProfile(profileId: PlayerProfileId | null): Promise<void> {
    this.selectedProfileId.value = profileId
    this.modules.context.publishRealtimeSelectedPlayerProfileId(profileId)
    const snapshot = this.snapshot.requestSnapshot('Selected player profile changed.')
    await flushAsync()
    await snapshot
  }

  async setRole(role: AuthRole | null): Promise<void> {
    if (role) this.role.value = role
    this.modules.context.setRealtimeClientAuthRole(role)
    await flushAsync()
  }

  dispose(): void {
    this.removeConnection?.()
    this.scope.stop()
    this.outbox.close()
    this.modules.liveSheetsModule.teardownLiveSheets()
    this.modules.realtime.resetRealtimeForTests()
    this.modules.apiClientModule.resetApiClientForTests()
    this.modules.context.resetRealtimeClientPrincipalContextForTests()
  }

  private setupRuntime(): void {
    const { useLiveSheets } = this.modules.liveSheetsModule
    const { useSharedMapInteractionMode } = this.modules.modeModule
    const { useEditableMap } = this.modules.editableMapModule
    const { useLiveTableSnapshotSync } = this.modules.snapshotModule
    const { useLivePlayCommands } = this.modules.commandsModule
    const { useLivePlayStateMachine } = this.modules.stateMachineModule
    const { useLivePlayCommandRecoveryGate } = this.modules.recoveryGateModule

    this.liveSheets = useLiveSheets({ autoHydrate: false, hydrationOwner: `${this.label}:chaos-arena` })
    this.mode = useSharedMapInteractionMode('chaos-arena', { autoLoad: false })

    let acknowledgeAcceptedRealtimeEvent: (event: LivePlayAcceptedRealtimeEvent) => Promise<void> = async () => undefined
    this.map = useEditableMap('chaos-arena', {
      autoLoad: false,
      interactionMode: this.mode.interactionMode,
      playerProfileId: computed(() => (this.role.value === 'player' ? this.selectedProfileId.value : null)),
      requestAuthoritativeReconciliation: (reason) => this.snapshot.requestSnapshot(reason),
      authoritativeReconciliationKey: computed(() => this.snapshot.currentAccessScopeKey.value),
      onLivePlayCommandAcceptedEvent: (event) => acknowledgeAcceptedRealtimeEvent(event),
    })

    this.snapshot = useLiveTableSnapshotSync({
      slug: 'chaos-arena',
      role: this.role,
      playerProfileId: computed(() => (this.role.value === 'player' ? this.selectedProfileId.value : null)),
      sheetCache: this.liveSheets,
      applyMap: this.map.applyPersistedMap,
      applyInteractionMode: this.mode.applyAuthoritativeMode,
    })

    const applyLivePlaySheetUpdate = (update: LivePlayCommandSheetUpdate): void => {
      const result = this.liveSheets.adoptSheetUpdate({
        kind: update.kind,
        slug: update.slug,
        sheet: update.sheet,
        preserveClientAccessAnnotations: true,
      })
      if (result.status === 'conflict' || result.status === 'invalid') {
        this.liveSheets.reportReconciliationRequired(result.message, { reload: false })
        throw new Error(result.message)
      }
    }

    const livePlayMapStatus = computed(() => {
      if (this.map.status.value === 'loading' || this.map.status.value === 'error' || this.map.status.value === 'not-found') {
        return this.map.status.value
      }
      if (this.snapshot.status.value === 'error' || this.liveSheets.reconciliationRequired.value) return 'error'
      if (!this.snapshot.ready.value || !this.liveSheets.hydrated.value) return 'loading'
      return this.map.status.value
    })
    const livePlayMapError = computed(() => this.snapshot.error.value ?? this.liveSheets.loadError.value ?? this.map.error.value)
    const stateMachine = useLivePlayStateMachine({
      mapStatus: livePlayMapStatus,
      mapError: livePlayMapError,
      realtimeStatus: this.map.realtimeReconciliationStatus,
      realtimeNotice: this.map.livePlayRealtimeNotice,
    })

    this.commands = useLivePlayCommands({
      slug: 'chaos-arena',
      authRole: this.role,
      playerProfileId: computed(() => (this.role.value === 'player' ? this.selectedProfileId.value : null)),
      map: this.map.map,
      mapRevision: this.map.mapRevision,
      livePlayCommandBlocked: computed(() => this.mode.interactionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT || !stateMachine.commandsAllowed.value),
      livePlayCommandBlockedMessage: computed(() => stateMachine.commandBlockMessage.value),
      newCommandBlocked: computed(() => this.recoveryGate?.blocksNewLiveCommands.value ?? true),
      newCommandBlockedMessage: computed(() => this.recoveryGate?.blockMessage.value ?? 'Checking recovery.'),
      applyPersistedMap: this.map.applyPersistedMap,
      applySheetUpdate: applyLivePlaySheetUpdate,
      requestReconciliation: () => stateMachine.reconcile(() => this.snapshot.requestSnapshot('Reconciling live table snapshot.')),
      onCommandStarted: () => stateMachine.commandStarted(),
      onCommandAccepted: (response) => {
        stateMachine.commandAccepted()
        this.presentationEvents.push(`accepted:${response.opId}`)
      },
      onCommandRejected: (transition) => stateMachine.commandRejected(transition),
      onCommandFailed: (message) => stateMachine.commandFailed(message),
      onCommandBlocked: (message) => stateMachine.commandBlocked(message),
      onCommandErrorCleared: () => stateMachine.clearCommandError(),
      outbox: this.outbox,
      leaseOwner: `${this.label}:lease`,
    })
    acknowledgeAcceptedRealtimeEvent = async (event) => {
      await this.commands.acknowledgeAcceptedRealtimeEvent(event)
    }

    this.recoveryGate = useLivePlayCommandRecoveryGate({
      contextKey: computed(() => `${this.role.value}:${this.selectedProfileId.value ?? 'none'}:chaos-arena`),
      enabled: computed(() => this.role.value === 'gm' || this.role.value === 'player'),
      interactionMode: this.mode.interactionMode,
      commandStatus: this.commands.status,
      entries: this.commands.outboxEntries,
      recoveryStatus: this.commands.outboxRecoveryStatus,
      recoveryError: this.commands.outboxRecoveryError,
      recoverInterrupted: this.commands.recoverInterruptedOutboxCommands,
      refresh: this.commands.refreshOutboxEntries,
      retry: this.commands.retryOutboxCommand,
      checkStatus: this.commands.checkOutboxCommandStatus,
      abandon: this.commands.abandonOutboxCommand,
      clock: {
        timers: this.timers as unknown as Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>,
        now: () => this.harness.nextTimestamp(),
      },
      browser: { isClient: true, document: null, window: null },
    })

    this.readiness = computed(() => (
      this.snapshot.ready.value
      && this.liveSheets.hydrated.value
      && !this.liveSheets.reconciliationRequired.value
      && this.map.realtimeReconciliationStatus.value !== 'reconnecting'
      && this.map.realtimeReconciliationStatus.value !== 'reconciling'
      && this.map.realtimeReconciliationStatus.value !== 'error'
      && this.commands.status.value !== 'saving'
      && !this.recoveryGate.blocksNewLiveCommands.value
      && this.mode.interactionMode.value === MAP_INTERACTION_MODES.LIVE_PLAY
    ))

    this.removeConnection = this.modules.realtime.subscribeRealtimeConnection(
      (change) => this.connectionChanges.push(change),
      { immediate: true },
    )
  }
}

export const moveTokenPosition = (map: TabletopMap | null, placementId = 'token-alpha') => (
  map?.placements.find((placement) => placement.id === placementId)?.position ?? null
)

export const createApiHandlerForTab = (
  harness: FullSystemChaosHarness,
  tabState: { readonly role: Ref<AuthRole>; readonly profileId: Ref<PlayerProfileId | null> },
): ClientTabApiHandler => ({
  getJson: (path, options) => harness.apiGet(path, options, tabState.role.value, tabState.profileId.value),
  postJson: (path, body) => harness.apiPost(path, body, tabState.role.value, tabState.profileId.value),
})
