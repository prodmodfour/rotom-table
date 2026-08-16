import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createClearHazardsCommandScopes,
  createEditTerrainVoxelsCommandScopes,
  type ClearHazardsLivePlayCommand,
  type ClearHazardsPayload,
  type EditTerrainVoxelsLivePlayCommand,
  type EditTerrainVoxelsPayload,
  type DismissEncounterEffectLivePlayCommand,
  type EndEncounterLivePlayCommand,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type ModifyCombatStagesLivePlayCommand,
  type ModifyConditionsLivePlayCommand,
  type ModifyHpLivePlayCommand,
  type MoveTokenLivePlayCommand,
  type NextInitiativeLivePlayCommand,
  type PreviousInitiativeLivePlayCommand,
  type ResolveMoveLivePlayCommand,
  type SetSceneLivePlayCommand,
  type UseMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, type RealtimeEvent } from '#shared/realtime'
import { acceptedCommandRealtimeAppendInput } from '~~/server/livePlay/acceptedCommandRealtime'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository, type LivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapRepository, type MapRepository } from '~~/server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '~~/server/storage/sheetRepository'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import type { AuthoritativeMoveRandomSource } from '~~/server/domain/moveAutomation/random'
import { executeLivePlayInitiativeCommandUseCase } from '~~/server/useCases/applyLivePlayInitiativeCommand'
import { executeLivePlayMapEffectsCommandUseCase } from '~~/server/useCases/applyLivePlayMapEffectsCommand'
import { executeLivePlaySceneCommandUseCase } from '~~/server/useCases/applyLivePlaySceneCommand'
import { executeLivePlayEncounterLifecycleCommandUseCase } from '~~/server/useCases/applyLivePlayEncounterLifecycleCommand'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import { executeLivePlaySheetCommandUseCase } from '~~/server/useCases/applyLivePlaySheetCommand'
import { executeLivePlayTerrainCommandUseCase } from '~~/server/useCases/applyLivePlayTerrainCommand'
import { executeLivePlayUseMoveCommandUseCase } from '~~/server/useCases/applyLivePlayUseMoveCommand'
import { executeMapTokenLivePlayCommandUseCase } from '~~/server/useCases/applyMapTokenAction'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import type { SheetKind, TabletopMap } from '~/types/map'

export interface LivePlayActorContext {
  readonly role: AuthRole
  readonly clientId: string
  readonly playerProfile?: PlayerProfile | null
}

export interface LivePlayRealtimeClient {
  readonly id: string
  readonly missedEvents: number
  readonly patchFailures: readonly string[]
  connected: boolean
  map: TabletopMap | null
  disconnect(): void
  reconnect(): Promise<TabletopMap>
  receive(event: RealtimeEvent): void
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const defaultMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Integration Arena',
  folder: '',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'alpha-mon',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 12,
    },
    {
      id: 'token-b',
      sheetKind: 'pokemon',
      sheetSlug: 'beta-mon',
      position: { x: 2, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 9,
    },
  ],
  lights: [],
  initiative: { activeId: 'token-a', round: 1 },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

const defaultPokemonSheet = (
  slug: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  slug,
  species: slug === 'alpha-mon' ? 'Pikachu' : 'Eevee',
  nickname: slug === 'alpha-mon' ? 'Alpha' : 'Beta',
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
})

export interface CreateLivePlayIntegrationHarnessOptions {
  readonly map?: TabletopMap
  readonly sheets?: readonly PersistedSheet[]
  readonly lifecycleHandlers?: readonly EncounterLifecycleTriggerHandler[]
  readonly random?: AuthoritativeMoveRandomSource
}

export interface LivePlayCommandDispatchOptions<TCommand> {
  readonly actor: LivePlayActorContext
  readonly command: TCommand
}

export class LivePlayIntegrationHarness {
  readonly tempRoot: string
  readonly database: RotomDatabase
  readonly mapRepository: MapRepository<TabletopMap>
  readonly sheetRepository: SheetRepository<Record<string, unknown>>
  readonly opRepository: LivePlayOpRepository
  readonly queue = createInProcessMapWriteQueue()
  readonly publishedEvents: RealtimeEvent[] = []

  private readonly clients = new Map<string, LivePlayRealtimeClient>()
  private readonly lifecycleHandlers: readonly EncounterLifecycleTriggerHandler[]
  private readonly random: AuthoritativeMoveRandomSource | undefined
  private readonly profiles: PlayerProfile[] = []
  private readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  private nowValue = 1_700_000_100_000
  private disposed = false

  private constructor(options: CreateLivePlayIntegrationHarnessOptions = {}) {
    this.tempRoot = mkdtempSync(join(tmpdir(), 'rotom-live-play-integration-'))
    this.lifecycleHandlers = options.lifecycleHandlers ?? []
    this.random = options.random
    this.database = openRotomDatabase({ path: join(this.tempRoot, 'campaign.sqlite') })
    this.mapRepository = createSqliteMapRepository<TabletopMap>(this.database)
    this.sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(this.database)
    this.opRepository = createSqliteLivePlayOpRepository({
      database: this.database,
      clock: () => this.nextTimestamp(),
    })
    const realtimeRepository = createSqliteRealtimeEventRepository({
      database: this.database,
      clock: () => this.nextTimestamp(),
    })
    this.commandExecutor = createAuthoritativeLivePlayCommandExecutor({
      opStore: this.opRepository,
      queue: this.queue,
      recordRealtimeEvents: (inputs) => realtimeRepository.appendMany(inputs),
      recordAcceptedRealtimeEvent: ({ command, result, clientId }) => {
        const [event] = realtimeRepository.appendMany([
          acceptedCommandRealtimeAppendInput({ command, result, clientId }),
        ])
        if (!event) throw new Error('accepted live-play realtime event append returned no event')
        return event
      },
      publishPersistedRealtimeEvent: (event) => this.publishSequencedRealtimeEvent(event.event),
    })

    this.seed(options)
  }

  static create(options: CreateLivePlayIntegrationHarnessOptions = {}): LivePlayIntegrationHarness {
    return new LivePlayIntegrationHarness(options)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.database.close()
    rmSync(this.tempRoot, { recursive: true, force: true })
  }

  async createMap(map: TabletopMap): Promise<TabletopMap> {
    return await this.mapRepository.saveSetupMap(map)
  }

  async createSheet(kind: SheetKind, slug: string, sheet: Record<string, unknown>): Promise<PersistedSheet> {
    return await this.sheetRepository.saveSetupSheet(kind, slug, sheet)
  }

  createPlayerProfile(input: {
    readonly id: string
    readonly displayName: string
    readonly linkedCharacters: PlayerProfile['linkedCharacters']
  }): PlayerProfile {
    const profile: PlayerProfile = {
      schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
      id: input.id as PlayerProfileId,
      displayName: input.displayName as PlayerProfileDisplayName,
      linkedCharacters: input.linkedCharacters,
    }
    this.profiles.push(profile)
    return profile
  }

  async loadClient(id: string, mapSlug = 'integration-arena'): Promise<LivePlayRealtimeClient> {
    const loaded = await this.readMap(mapSlug)
    if (!loaded) throw new Error(`Map ${mapSlug} was not found`)

    let missedEvents = 0
    const failures: string[] = []
    const client: LivePlayRealtimeClient = {
      id,
      connected: true,
      map: cloneJson(loaded),
      get missedEvents() {
        return missedEvents
      },
      get patchFailures() {
        return [...failures]
      },
      disconnect: () => {
        client.connected = false
      },
      reconnect: async () => {
        const reloaded = await this.readMap(mapSlug)
        if (!reloaded) throw new Error(`Map ${mapSlug} was not found on reconnect`)
        client.map = cloneJson(reloaded)
        client.connected = true
        return client.map
      },
      receive: (event: RealtimeEvent) => {
        if (event.channel !== `map:${mapSlug}`) return
        if (!client.connected) {
          missedEvents += 1
          return
        }
        if (event.type !== LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED) return
        const result = applyLivePlayPatchesToMap({
          map: client.map,
          mapSlug,
          previousRevision: event.previousRevision,
          revision: event.revision ?? 0,
          patches: event.patches ?? [],
        })
        if (!result.ok) failures.push(result.reason)
      },
    }

    this.clients.set(id, client)
    return client
  }

  async readMap(slug = 'integration-arena'): Promise<TabletopMap | null> {
    const map = await this.mapRepository.getBySlug(slug)
    return map ? cloneJson(map) : null
  }

  async readSheet(kind: SheetKind, slug: string): Promise<PersistedSheet | null> {
    const sheet = await this.sheetRepository.getByRef(kind, slug)
    return sheet ? cloneJson(sheet) : null
  }

  operationRecordCount(): number {
    const row = this.database.connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get() as { count: unknown } | undefined
    return Number(row?.count ?? 0)
  }

  acceptedOperationRevisions(mapSlug = 'integration-arena'): number[] {
    const currentRevision = this.mapRepository.get(mapSlug)?.revision ?? 0
    return this.opRepository.listAcceptedOpsSinceRevision({
      mapSlug,
      baseRevision: 0,
      currentRevision,
    }).map((operation) => operation.revision)
  }

  staleBaseRevision(_mapSlug = 'integration-arena'): number {
    return 0
  }

  async moveToken({ actor, command }: LivePlayCommandDispatchOptions<MoveTokenLivePlayCommand>) {
    return await executeMapTokenLivePlayCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    }, this.commandDependencies())
  }

  async resolveMove({ actor, command }: LivePlayCommandDispatchOptions<ResolveMoveLivePlayCommand>) {
    return await this.resolveMoveWithPlanner({ actor, command })
  }

  async resolveMoveWithPlanner({
    actor,
    command,
    planner,
  }: LivePlayCommandDispatchOptions<ResolveMoveLivePlayCommand> & {
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  }) {
    return await executeLivePlayResolveMoveCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    }, {
      ...this.commandDependencies(),
      ...(planner ? { planner } : {}),
    })
  }

  async nextInitiative({ actor, command }: LivePlayCommandDispatchOptions<NextInitiativeLivePlayCommand>) {
    return await executeLivePlayInitiativeCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
    }, this.commandDependencies())
  }

  async previousInitiative({ actor, command }: LivePlayCommandDispatchOptions<PreviousInitiativeLivePlayCommand>) {
    return await executeLivePlayInitiativeCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
    }, this.commandDependencies())
  }

  async setScene({ actor, command }: LivePlayCommandDispatchOptions<SetSceneLivePlayCommand>) {
    return await executeLivePlaySceneCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
    }, this.commandDependencies())
  }

  async endEncounter({ actor, command }: LivePlayCommandDispatchOptions<EndEncounterLivePlayCommand>) {
    return await executeLivePlayEncounterLifecycleCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER,
    }, this.commandDependencies())
  }

  async dismissEncounterEffect({ actor, command }: LivePlayCommandDispatchOptions<DismissEncounterEffectLivePlayCommand>) {
    return await executeLivePlayEncounterLifecycleCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT,
    }, this.commandDependencies())
  }

  async clearHazards({ actor, command }: LivePlayCommandDispatchOptions<ClearHazardsLivePlayCommand>) {
    return await executeLivePlayMapEffectsCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
    }, this.commandDependencies())
  }

  async editTerrainVoxels({ actor, command }: LivePlayCommandDispatchOptions<EditTerrainVoxelsLivePlayCommand>) {
    return await executeLivePlayTerrainCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
    }, this.commandDependencies())
  }

  async modifyHp({ actor, command }: LivePlayCommandDispatchOptions<ModifyHpLivePlayCommand>) {
    return await executeLivePlaySheetCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
    }, this.commandDependencies())
  }

  async modifyCombatStages({ actor, command }: LivePlayCommandDispatchOptions<ModifyCombatStagesLivePlayCommand>) {
    return await executeLivePlaySheetCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
    }, this.commandDependencies())
  }

  async modifyConditions({ actor, command }: LivePlayCommandDispatchOptions<ModifyConditionsLivePlayCommand>) {
    return await executeLivePlaySheetCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
    }, this.commandDependencies())
  }

  async useMove({ actor, command }: LivePlayCommandDispatchOptions<UseMoveLivePlayCommand>) {
    return await executeLivePlayUseMoveCommandUseCase({
      role: actor.role,
      clientId: actor.clientId,
      playerProfile: actor.playerProfile,
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
    }, this.commandDependencies())
  }

  endEncounterCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly reason?: 'completed' | 'cancelled' | 'gm-ended'
  }): EndEncounterLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.END_ENCOUNTER,
      scopes: [{ kind: 'map', lane: 'encounter' }],
      payload: { reason: input.reason ?? 'completed' },
    }
  }

  dismissEncounterEffectCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly effectId: string
  }): DismissEncounterEffectLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.DISMISS_ENCOUNTER_EFFECT,
      scopes: [{ kind: 'map', lane: 'encounter' }],
      payload: { effectId: input.effectId },
    }
  }

  moveTokenCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly placementId: string
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
  }): MoveTokenLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: input.placementId, field: 'position' }],
      payload: {
        placementId: input.placementId,
        position: input.position,
      },
    }
  }

  resolveMoveCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly intent: ResolveMoveIntent
    readonly candidateScopePlacementIds?: readonly string[]
  }): ResolveMoveLivePlayCommand {
    const map = this.mapRepository.getBySlug('integration-arena')
    if (!map) throw new Error('integration-arena was not found')
    const scopes = buildResolveMoveScopes({
      map,
      intent: input.intent,
      candidateScopePlacementIds: input.candidateScopePlacementIds ?? [],
    })
    if (!scopes.ok) throw new Error(scopes.message)
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
      scopes: scopes.scopes,
      payload: input.intent,
    }
  }

  nextInitiativeCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly orderIds?: readonly string[]
    readonly activeId?: string | null
    readonly round?: number
  }): NextInitiativeLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
      payload: {
        orderIds: [...(input.orderIds ?? ['token-a', 'token-b'])],
        activeId: input.activeId === undefined ? 'token-a' : input.activeId,
        round: input.round ?? 1,
      },
    }
  }

  previousInitiativeCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly orderIds?: readonly string[]
    readonly activeId?: string | null
    readonly round?: number
  }): PreviousInitiativeLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
      payload: {
        orderIds: [...(input.orderIds ?? ['token-a', 'token-b'])],
        activeId: input.activeId === undefined ? 'token-a' : input.activeId,
        round: input.round ?? 1,
      },
    }
  }

  setSceneCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly name: string | null
  }): SetSceneLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: input.name },
    }
  }

  clearHazardsCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly payload: ClearHazardsPayload
  }): ClearHazardsLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
      scopes: createClearHazardsCommandScopes(input.payload),
      payload: input.payload,
    }
  }

  editTerrainVoxelsCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly payload: EditTerrainVoxelsPayload
  }): EditTerrainVoxelsLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
      scopes: createEditTerrainVoxelsCommandScopes(input.payload),
      payload: input.payload,
    }
  }

  modifyHpCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly placementId: string
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly currentHp: number
    readonly injuries?: number
  }): ModifyHpLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [
        { kind: 'token', placementId: input.placementId, field: 'hp' },
        { kind: 'sheet', sheetKind: input.sheetKind, sheetSlug: input.sheetSlug, field: 'hp' },
      ],
      payload: {
        placementId: input.placementId,
        currentHp: input.currentHp,
        ...(input.injuries === undefined ? {} : { injuries: input.injuries }),
      },
    }
  }

  modifyCombatStagesCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly placementId: string
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly stages: ModifyCombatStagesLivePlayCommand['payload']['stages']
  }): ModifyCombatStagesLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
      scopes: [
        { kind: 'token', placementId: input.placementId, field: 'combatStages' },
        { kind: 'sheet', sheetKind: input.sheetKind, sheetSlug: input.sheetSlug, field: 'combatStages' },
      ],
      payload: {
        placementId: input.placementId,
        stages: input.stages,
      },
    }
  }

  modifyConditionsCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly placementId: string
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly action?: ModifyConditionsLivePlayCommand['payload']['action']
    readonly conditions: readonly string[]
  }): ModifyConditionsLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
      scopes: [
        { kind: 'token', placementId: input.placementId, field: 'conditions' },
        { kind: 'sheet', sheetKind: input.sheetKind, sheetSlug: input.sheetSlug, field: 'conditions' },
      ],
      payload: {
        placementId: input.placementId,
        action: input.action ?? 'replace',
        conditions: input.conditions,
      },
    }
  }

  useMoveCommand(input: {
    readonly opId: string
    readonly baseRevision: number
    readonly placementId: string
    readonly sheetKind: SheetKind
    readonly sheetSlug: string
    readonly moveName: string
    readonly daily?: boolean
  }): UseMoveLivePlayCommand {
    return {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'integration-arena',
      baseRevision: input.baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      scopes: [
        { kind: 'token', placementId: input.placementId, field: 'moveUsage' },
        ...(input.daily ? [{ kind: 'sheet' as const, sheetKind: input.sheetKind, sheetSlug: input.sheetSlug, field: 'moveUsage' }] : []),
      ],
      payload: {
        placementId: input.placementId,
        moveName: input.moveName,
      },
    }
  }

  private seed(options: CreateLivePlayIntegrationHarnessOptions): void {
    const map = options.map ?? defaultMap()
    this.mapRepository.save({
      slug: map.slug,
      document: map,
      revision: map.revision ?? 0,
      updatedAt: map.updatedAt ?? 1_700_000_000_000,
    })

    const sheets = options.sheets ?? [
      {
        kind: 'pokemon',
        slug: 'alpha-mon',
        revision: 0,
        updatedAt: 1_700_000_000_000,
        sheet: defaultPokemonSheet('alpha-mon'),
      },
      {
        kind: 'pokemon',
        slug: 'beta-mon',
        revision: 0,
        updatedAt: 1_700_000_000_000,
        sheet: defaultPokemonSheet('beta-mon', {
          movelist: [{ name: 'Daily Spark', frequency: 'Daily x2' }],
        }),
      },
    ] satisfies readonly PersistedSheet[]

    for (const sheet of sheets) {
      this.sheetRepository.save({
        kind: sheet.kind,
        slug: sheet.slug,
        document: sheet.sheet,
        revision: sheet.revision,
        updatedAt: sheet.updatedAt,
      })
    }
  }

  private nextTimestamp(): number {
    this.nowValue += 1
    return this.nowValue
  }

  private publishSequencedRealtimeEvent(event: RealtimeEvent): void {
    this.publishedEvents.push(cloneJson(event))
    for (const client of this.clients.values()) client.receive(event)
  }

  private commandDependencies() {
    return {
      commandExecutor: this.commandExecutor,
      mapRepository: this.mapRepository,
      sheetRepository: this.sheetRepository,
      database: this.database,
      relativePath: (path: string) => path,
      now: () => this.nextTimestamp(),
      lifecycleHandlers: this.lifecycleHandlers,
      random: this.random,
      listProfiles: () => [...this.profiles],
    }
  }
}

export const assertAccepted = (result: LivePlayCommandResult): LivePlayCommandAccepted => {
  if (result.ok !== true || 'duplicate' in result) {
    throw new Error(`Expected accepted live-play result, received ${JSON.stringify(result)}`)
  }
  return result
}
