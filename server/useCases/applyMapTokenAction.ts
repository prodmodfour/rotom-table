import { createHash } from 'node:crypto'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { applyAa061BallFetchSendOutTriggers } from '../domain/abilityAutomation/mechanics/aa061PresenceIntegration'
import { applyAa065CuriousMedicineSendOutTrigger } from '../domain/abilityAutomation/mechanics/aa065PresenceIntegration'
import { removeCapabilityPresenceGroup } from '../domain/capabilityAutomation/presenceLifecycle'
import { resolveEffectiveCapabilities } from '../domain/capabilityAutomation/effectiveCapabilities'
import { effectiveRuntimeAbilityIds } from '../domain/abilityAutomation/effectiveRuntimeAbilities'
import { rebindZygardeAssemblyOnPresence } from '../domain/capabilityAutomation/zygardeAssembly'
import { parseCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import {
  marsupialRelationshipClaimedSlugs,
  marsupialRelationshipPlacementIds,
  resolveMarsupialRelationship,
  type ValidMarsupialRelationship,
} from '../domain/capabilityAutomation/marsupialRelationship'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  isMoveTokenMovementPolicy,
  parseLivePlayOpId,
  type DeleteTokenLivePlayCommand,
  type DeleteTokenPayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayTokenScope,
  type MoveTokenLivePlayCommand,
  type MoveTokenMovementPolicy,
  type MoveTokenPayload,
  type LivePlayOpId,
  type SendOutPokemonLivePlayCommand,
  type SendOutPokemonPayload,
  type SpawnTokenLivePlayCommand,
  type SpawnTokenPayload,
  type TurnTokenLivePlayCommand,
  type TurnTokenPayload,
} from '#shared/livePlayCommands'
import {
  createEmptyEncounterState,
  encounterStateHasSide,
  isEncounterSideId,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterRecallEvent,
  type EncounterSendOutEvent,
} from '#shared/moveAutomation/events'
import {
  createPendingMoveDeclarationResult,
  type PendingMoveDeclarationResult,
  type PendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { isSheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import { pokemonMarsupialBabyActionRestricted } from '~/utils/sheets/pokemonDerived'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'
import { canPlacePokemon } from '~/utils/gridPlacement'
import {
  isSendOutPositionWithinThrowRange,
} from '~/utils/mapTokenSendOut'
import { trainerThrowingRangeMeters } from '~/utils/pokeballCapture'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import {
  DEFAULT_TOKEN_FACING_DIRECTION,
  isTokenFacingDirection,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { readRuntimeSheet } from '../utils/sqliteSheetRuntimeHelpers'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { createLivePlayCommandHash, type LivePlayCommandHash } from '../livePlay/opResult'
import { acceptedCommandRealtimeAppendInput } from '../livePlay/acceptedCommandRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '../storage/pendingMoveResolutionRepository'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import {
  resolveAuthoritativeMovement,
  type AuthoritativeMovementSheetRead,
  type AuthoritativeMovementSheets,
  type AuthoritativeMovementSuccess,
} from '../domain/movement/resolveMovement'
import { EncounterResourceReductionError } from '../domain/moveAutomation/reduceEncounterResources'
import { reduceEncounterHistoryEvent } from '../domain/moveAutomation/reduceEncounterHistory'
import { planAuthoritativeMovementResources } from '../domain/movement/planMovementResources'
import { applyAuthoritativeMovementMapTransition } from '../domain/movement/applyMovementTransition'
import {
  planBattlefieldZoneMovement,
  type PlannedBattlefieldZoneMovement,
} from '../domain/moveAutomation/planBattlefieldZoneMovement'
import type { AuthoritativeMoveSheetWritePlan } from '../domain/planAuthoritativeMoveState'
import {
  isPreStepMovementAttackOfOpportunity,
  materializeMovementAttackOfOpportunity,
  movementAttackOfOpportunityPersistenceIdentity,
} from '../domain/moveAutomation/attackOfOpportunity'
import { commitLivePlayMapUpdate } from './livePlayMapPersistence'
import { toPersistedMap } from './saveMap'
import { createMoveStateChangePlan } from '../domain/moveAutomation/plan'
import { listPlayerProfiles } from '../utils/playerProfileStorage'
import { playerCharacterSheetKeysForProfiles } from '~/utils/playerCharacterTokens'
import { reconcileCapabilityRuntimeSourceLoss } from '../domain/capabilityAutomation/sourceLoss'

export class MapTokenActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface MoveMapTokenInput {
  role: AuthRole
  slug: string
  placementId: string
  position: GridAnchor
  clientId?: string
  playerProfile?: PlayerProfile | null
  /** Legacy preview hint; authoritative movement never consumes it. */
  pathLength?: number | null
  movementPolicy?: MoveTokenMovementPolicy
}

export interface TurnMapTokenInput {
  role: AuthRole
  slug: string
  placementId: string
  facing: TokenFacingDirection
  clientId?: string
  playerProfile?: PlayerProfile | null
}

export type MapTokenLivePlayCommand =
  | MoveTokenLivePlayCommand
  | TurnTokenLivePlayCommand
  | SpawnTokenLivePlayCommand
  | SendOutPokemonLivePlayCommand
  | DeleteTokenLivePlayCommand

export type MapTokenLivePlayCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
  | typeof LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
  | typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN

export interface MapTokenLivePlayActor {
  role: AuthRole
  clientId?: string
  playerProfile?: PlayerProfile | null
}

export interface ExecuteMapTokenLivePlayCommandInput {
  role: AuthRole
  command: unknown
  clientId?: string
  playerProfile?: PlayerProfile | null
  expectedType?: MapTokenLivePlayCommandType
}

export interface MapTokenLivePlayCommandResponse {
  result: LivePlayCommandResult
  path?: string
  map?: TabletopMap
  placement?: SheetPlacement
}

interface SheetFileRecord {
  sheet: Record<string, unknown>
}

export interface MapTokenActionDependencies {
  readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  now?: () => number
  relativePath?: (path: string) => string
  maxMovementLogEntries?: number
  commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'>
    & Partial<Pick<SheetRepository<Record<string, unknown>>, 'applyLivePlayUpdate' | 'assertRevisions'>>
  pendingResolutionRepository?: Pick<
    PendingMoveResolutionRepository,
    'getByOrigin' | 'create'
  >
  listProfiles?: () => readonly PlayerProfile[]
  database?: Pick<RotomDatabase, 'withTransaction'> & Partial<Pick<RotomDatabase, 'connection'>>
}

interface ResolvedMapWriteContext {
  mapPath: string
  relativePath: string
  map: TabletopMap
  authoritativeSheets?: AuthoritativeMovementSheets
}

interface ResolvedMapTokenActionContext extends ResolvedMapWriteContext {
  placement: SheetPlacement
}

interface ResolvedMapTokenCommandResponseContext extends ResolvedMapWriteContext {
  placement?: SheetPlacement
}

const optionalText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const fallbackPlacementName = (placement: Pick<SheetPlacement, 'sheetSlug'>): string => placement.sheetSlug

const sheetDisplayName = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
): string => {
  try {
    const sheet = readSheet(placement.sheetKind, placement.sheetSlug)?.sheet
    if (!sheet) return fallbackPlacementName(placement)

    if (placement.sheetKind === 'pokemon') {
      return optionalText(sheet.nickname)
        ?? optionalText(sheet.species)
        ?? fallbackPlacementName(placement)
    }

    return optionalText(sheet.name) ?? fallbackPlacementName(placement)
  } catch {
    return fallbackPlacementName(placement)
  }
}

const readDefaultSheet = (
  kind: SheetKind,
  slug: string,
  repository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'>,
): SheetFileRecord | null => readRuntimeSheet<Record<string, unknown>>(kind, slug, repository)

const livePlayMapTokenCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: MapTokenActionDependencies) => {
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const database = dependencies.database ?? getRotomDatabase()
  const pendingResolutionRepository = dependencies.pendingResolutionRepository
    ?? ('connection' in database && database.connection
      ? createSqlitePendingMoveResolutionRepository(database as RotomDatabase)
      : null)
  return {
    readSheet: dependencies.readSheet
      ?? ((kind: SheetKind, slug: string) => readDefaultSheet(kind, slug, sheetRepository)),
    now: dependencies.now ?? Date.now,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
    maxMovementLogEntries: dependencies.maxMovementLogEntries,
    commandExecutor: dependencies.commandExecutor ?? livePlayMapTokenCommandExecutor,
    mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
    sheetRepository,
    pendingResolutionRepository,
    listProfiles: dependencies.listProfiles ?? listPlayerProfiles,
    database,
  }
}

type MapTokenActionDependencySet = ReturnType<typeof actionDependencies>

const tokenControlTrainerSheet = (
  slug: string,
  sheet: Record<string, unknown>,
): ServerTokenControlLinkedTrainerSheet => ({
  slug,
  ...(Array.isArray(sheet.currentTeam) ? { currentTeam: sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.boxedPokemon) ? { boxedPokemon: sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = (
  actor: MapTokenLivePlayActor,
  dependencies: MapTokenActionDependencySet,
) => playerProfileLinkedTrainerSheetsForTokenControl(
  actor.playerProfile,
  (slug) => {
    const record = dependencies.readSheet('trainer', slug)
    return record ? tokenControlTrainerSheet(slug, record.sheet) : null
  },
)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const resolveLivePlayMapWriteContext = async (
  input: Pick<MoveMapTokenInput, 'role' | 'slug'>,
  dependencies: MapTokenActionDependencySet,
): Promise<ResolvedMapWriteContext> => {
  const map = await dependencies.mapRepository.getBySlug(input.slug)
  if (!map) throw new MapTokenActionUseCaseError(404, `Map ${input.slug}.json not found`)

  if (!canAccessMapForRole(input.role, map)) {
    throw new MapTokenActionUseCaseError(403, 'Map is not player visible')
  }

  const mapPath = mapPathForDocument(map)
  const authoritativeSheets = authoritativeMovementSheetsForMap(map, dependencies.readSheet)
  const reconciledMap = reconcileCapabilityRuntimeSourceLoss({
    map,
    sheets: authoritativeSheets,
  })
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map: reconciledMap,
    authoritativeSheets,
  }
}

const clonePosition = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const positionsEqual = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const authoritativeMovementSheetsForMap = (
  map: TabletopMap,
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
): AuthoritativeMovementSheets => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()

  for (const placement of map.placements) {
    const destination = placement.sheetKind === 'pokemon' ? pokemon : trainer
    if (destination.has(placement.sheetSlug)) continue
    const record = readSheet(placement.sheetKind, placement.sheetSlug)
    if (!record) continue
    const sheet = { ...record.sheet, slug: placement.sheetSlug }
    if (placement.sheetKind === 'pokemon') {
      pokemon.set(placement.sheetSlug, sheet as unknown as CharacterSheet)
    } else {
      trainer.set(placement.sheetSlug, sheet as unknown as TrainerSheet)
    }
  }

  return { pokemon, trainer }
}

interface ResolvedNormalTokenMovement {
  readonly movement: AuthoritativeMovementSuccess
  readonly sourceOperationId: string
  readonly encounterState: EncounterState
  /** Resource and zone state before the placement endpoint is committed. */
  readonly mapBeforeTransition: TabletopMap
  readonly zonePlan: PlannedBattlefieldZoneMovement | null
  readonly sheets: AuthoritativeMovementSheets
}

const resolveNormalTokenMovement = (
  payload: MoveTokenPayload,
  actor: MapTokenLivePlayActor,
  context: ResolvedMapTokenActionContext,
  currentRevision: number,
  sourceOperationId: string,
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
): ResolvedNormalTokenMovement | null => {
  if (payload.movementPolicy === 'gm-override' && actor.role !== 'gm') {
    rejectLivePlayCommand('unauthorized', 'Only a GM can request the explicit movement override policy', {
      currentRevision,
    })
  }

  const sheets = context.authoritativeSheets ?? authoritativeMovementSheetsForMap(context.map, readSheet)
  const movement = resolveAuthoritativeMovement({
    map: context.map,
    sheets,
    placementId: payload.placementId,
    mode: 'shift',
    destination: payload.position,
    policy: payload.movementPolicy === 'gm-override'
      ? { kind: 'gm-override' }
      : { kind: 'standard' },
  })

  if (movement.ok) {
    try {
      const resourcePlan = planAuthoritativeMovementResources({
        map: context.map,
        movement,
        sourceOperationId,
      })
      const resourceMap: TabletopMap = {
        ...resourcePlan.nextMap,
        encounterState: resourcePlan.currentEncounterState,
      }
      const zonePlan = movement.policy.kind === 'standard'
        ? planBattlefieldZoneMovement({
            map: resourceMap,
            pokemonSheets: sheets.pokemon,
            trainerSheets: sheets.trainer,
            movement: {
              movement,
              movementId: `movement:${sourceOperationId}`,
              sourceOperationId,
              mode: 'voluntary',
            },
            time: context.map.updatedAt ?? 0,
          })
        : null
      return {
        movement,
        sourceOperationId,
        encounterState: zonePlan?.currentEncounterState ?? resourcePlan.currentEncounterState,
        mapBeforeTransition: zonePlan?.nextMap ?? resourceMap,
        zonePlan,
        sheets,
      }
    }
    catch (error) {
      if (error instanceof EncounterResourceReductionError) {
        return rejectLivePlayCommand(
          'conflict',
          `Token ${payload.placementId} cannot pay its authoritative movement resources (${error.code}): ${error.message}`,
          {
            currentRevision,
            currentState: context.placement,
          },
        )
      }
      throw error
    }
  }
  if (movement.reasonCode === 'movement-same-position-disallowed') return null

  return rejectLivePlayCommand(
    'conflict',
    `Token ${payload.placementId} cannot move to the requested destination (${movement.reasonCode}): ${movement.message}`,
    {
      currentRevision,
      currentState: context.placement,
    },
  )
}

const assertMovementSheetReads = (
  reads: readonly AuthoritativeMovementSheetRead[],
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
  currentRevision: number,
): void => {
  for (const read of reads) {
    const current = readSheet(read.kind, read.slug)
    if (current && normalizeRevision(current.sheet.revision) === read.revision) continue
    rejectLivePlayCommand(
      'conflict',
      'A sheet consulted by authoritative movement changed before the token position could commit.',
      { currentRevision },
    )
  }
}

const persistMovementSheetWrites = (
  writes: readonly AuthoritativeMoveSheetWritePlan[],
  repository: MapTokenActionDependencySet['sheetRepository'],
): void => {
  if (writes.length === 0) return
  if (!repository.applyLivePlayUpdate) {
    throw new MapTokenActionUseCaseError(
      409,
      'Authoritative movement produced sheet state without an atomic sheet repository.',
    )
  }
  for (const write of writes) {
    const result = repository.applyLivePlayUpdate({
      kind: write.kind,
      slug: write.slug,
      expectedRevision: write.expectedRevision,
      nextSheet: write.nextSheet as unknown as Record<string, unknown>,
    })
    if (result === 'stale') {
      throw new MapTokenActionUseCaseError(
        409,
        `${write.kind} sheet ${write.slug} changed before movement zone effects could persist.`,
      )
    }
    const stored = repository.getByRef(write.kind, write.slug)
    if (!stored || normalizeRevision(stored.revision) !== normalizeRevision(write.revision)) {
      throw new MapTokenActionUseCaseError(
        409,
        `${write.kind} sheet ${write.slug} did not commit its planned movement-zone revision.`,
      )
    }
  }
}

interface AppliedMapTokenChange {
  readonly nextMap: TabletopMap
  readonly placement: SheetPlacement
  readonly timestamp?: number
  readonly additionalPlacementChanges?: readonly {
    readonly placement: SheetPlacement
    readonly previous: SheetPlacement | null
    readonly current: SheetPlacement | null
  }[]
  readonly turnResources?: {
    readonly previous: EncounterState['turnResources']
    readonly current: EncounterState['turnResources']
  }
}

const applyResolvedMoveTokenToMap = (
  resolved: ResolvedNormalTokenMovement,
  context: ResolvedMapTokenActionContext,
  dependencies: Required<Pick<MapTokenActionDependencies, 'readSheet' | 'now'>> & Pick<MapTokenActionDependencies, 'maxMovementLogEntries'>,
): AppliedMapTokenChange => {
  const transition = applyAuthoritativeMovementMapTransition({
    map: resolved.mapBeforeTransition,
    placementId: context.placement.id,
    destination: resolved.movement.destination,
    distance: resolved.movement.cost,
    encounterState: resolved.encounterState,
    timestamp: dependencies.now(),
    userName: sheetDisplayName(context.placement, dependencies.readSheet),
    linkedCompanionPlacementIds: resolved.movement.linkedCompanionPlacementIds,
    maxLogEntries: dependencies.maxMovementLogEntries,
    movementEvidence: {
      operationId: resolved.sourceOperationId,
      path: resolved.movement.path,
      mode: 'voluntary',
    },
  })
  return {
    nextMap: transition.nextMap,
    placement: transition.placement,
    timestamp: transition.nextMap.updatedAt,
    turnResources: {
      previous: parseEncounterState(
        context.map.encounterState ?? createEmptyEncounterState(),
      ).turnResources,
      current: resolved.encounterState.turnResources,
    },
  }
}

const applyTurnTokenToMap = (
  input: Pick<TurnMapTokenInput, 'facing'>,
  context: ResolvedMapTokenActionContext,
): AppliedMapTokenChange | null => {
  if (!isTokenFacingDirection(input.facing)) {
    throw new MapTokenActionUseCaseError(400, 'facing must be a token facing direction')
  }

  const turned = tokenFacingStoresLegacyTurned(input.facing)
  if (context.placement.facing === input.facing && context.placement.turned === turned) {
    return null
  }

  const nextPlacement: SheetPlacement = {
    ...context.placement,
    facing: input.facing,
    turned,
  }
  const placements = context.map.placements.map((placement) => (
    placement.id === context.placement.id ? nextPlacement : placement
  ))

  return {
    nextMap: {
      ...context.map,
      placements,
    },
    placement: nextPlacement,
  }
}

const isPositionWithinMapBounds = (
  position: GridAnchor,
  map: Pick<TabletopMap, 'dimensions'>,
): boolean => (
  Number.isFinite(position.x)
  && Number.isFinite(position.y)
  && Number.isFinite(position.z)
  && position.x >= 0
  && position.y >= 0
  && position.z >= 0
  && position.x < map.dimensions.x
  && position.y < map.dimensions.y
  && position.z < map.dimensions.z
)

const marsupialPokemonCandidates = (input: {
  readonly subject: CharacterSheet
  readonly map: TabletopMap
  readonly readSheet: NonNullable<MapTokenActionDependencies['readSheet']>
  readonly additionalSlugs?: readonly string[]
  readonly authoritativeSheets?: AuthoritativeMovementSheets
}): ReadonlyMap<string, CharacterSheet> => {
  const pokemon = new Map(input.authoritativeSheets?.pokemon ?? [])
  pokemon.set(input.subject.slug, input.subject)
  const slugs = new Set([
    ...marsupialRelationshipClaimedSlugs(input.subject),
    ...(input.additionalSlugs ?? []),
    ...input.map.placements.filter(placement => placement.sheetKind === 'pokemon').map(placement => placement.sheetSlug),
  ])
  for (const slug of slugs) {
    if (pokemon.has(slug)) continue
    const record = input.readSheet('pokemon', slug)
    if (record) pokemon.set(slug, { ...record.sheet, slug } as unknown as CharacterSheet)
  }
  return pokemon
}

const normalizeLivePlaySpawnPlacement = (placement: SheetPlacement): SheetPlacement => {
  const facing = tokenFacingForPlacement(placement)
  return {
    id: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    position: clonePosition(placement.position),
    ...(placement.sideId === undefined ? {} : { sideId: placement.sideId }),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    ...(placement.initiative === undefined ? {} : { initiative: placement.initiative }),
  }
}

const applySpawnTokenToMap = (
  payload: SpawnTokenPayload,
  context: ResolvedMapWriteContext,
  dependencies: MapTokenActionDependencySet,
  operationId: string,
): AppliedMapTokenChange => {
  const placement = normalizeLivePlaySpawnPlacement(payload.placement)
  if (!isPositionWithinMapBounds(placement.position, context.map)) {
    rejectLivePlayCommand('invalid', `spawnToken placement ${placement.id} position is outside map bounds`)
  }
  if (placement.sheetKind === 'pokemon') {
    const record = dependencies.readSheet('pokemon', placement.sheetSlug)
      ?? rejectLivePlayCommand('not-found', `pokemon sheet ${placement.sheetSlug} not found`)
    const sheet = { ...record.sheet, slug: placement.sheetSlug } as unknown as CharacterSheet
    if (sheet.letterPressCombinedInto) {
      rejectLivePlayCommand('conflict', `Pokémon ${placement.sheetSlug} is irreversibly combined into Prime Unown ${sheet.letterPressCombinedInto.ownerSheetSlug}`)
    }
    if (sheet.zygardeDisassembledIntoCells) {
      rejectLivePlayCommand('conflict', `Zygarde ${placement.sheetSlug} was irreversibly disassembled into Cells`)
    }
    const relationship = resolveMarsupialRelationship({
      subjectSlug: placement.sheetSlug,
      pokemonBySlug: marsupialPokemonCandidates({
        subject: sheet,
        map: context.map,
        readSheet: dependencies.readSheet,
        authoritativeSheets: context.authoritativeSheets,
      }),
    })
    if (relationship.status === 'corrupt') rejectLivePlayCommand('conflict', relationship.message)
    const abilityIds = effectiveRuntimeAbilityIds({ map: context.map, placement, sheet })
    const parentalBondActive = abilityIds.includes('Parental Bond')
    if (pokemonMarsupialBabyActionRestricted(sheet, abilityIds)) {
      const motherSlug = relationship.status === 'valid' ? relationship.pouch.motherSheetSlug : null
      rejectLivePlayCommand('conflict', `Baby-Template Kangaskhan ${placement.sheetSlug} cannot deploy independently${motherSlug ? ` from its mother ${motherSlug}` : ''}`)
    }
    if (relationship.status === 'valid'
      && !(relationship.subjectRole === 'baby' && parentalBondActive)) {
      rejectLivePlayCommand('conflict', `Bound Marsupial Pokémon ${placement.sheetSlug} must deploy through an authoritative paired send-out`)
    }
  }
  if (context.map.placements.some((candidate) => candidate.id === placement.id)) {
    rejectLivePlayCommand('conflict', `Placement ${placement.id} already exists`, {
      currentRevision: normalizeRevision(context.map.revision),
      currentState: context.map.placements.find((candidate) => candidate.id === placement.id),
    })
  }

  let nextMap: TabletopMap = {
    ...context.map,
    placements: [...context.map.placements, placement],
  }
  if (placement.sheetKind === 'pokemon') {
    const record = dependencies.readSheet('pokemon', placement.sheetSlug)!
    const sheet = { ...record.sheet, slug: placement.sheetSlug } as unknown as CharacterSheet
    try {
      nextMap = rebindZygardeAssemblyOnPresence({
        map: nextMap,
        placement,
        sheet,
        pokemonSheets: new Map([[sheet.slug, sheet]]),
        trainerSheets: new Map(),
        now: Math.max(0, context.map.updatedAt ?? 0),
        operationId,
      })
    }
    catch (error) {
      rejectLivePlayCommand('conflict', error instanceof Error ? error.message : 'Zygarde assembly authority could not be restored')
    }
  }
  return { nextMap, placement }
}

interface ResolvedSendOutPokemonMapContext {
  readonly trainerPlacement: SheetPlacement
  readonly placement: SheetPlacement
  readonly trainerSheet: TrainerSheet
  readonly pokemonSheet: CharacterSheet
  readonly trainerToken: SpawnedPokemon
  readonly pokemonToken: SpawnedPokemon
  readonly marsupialRelationship: ValidMarsupialRelationship | null
  readonly marsupialBaby: { readonly placement: SheetPlacement; readonly sheet: CharacterSheet } | null
}

const typedSheetLookupForPlacement = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  sheet: Record<string, unknown>,
): SheetLookup => {
  if (placement.sheetKind === 'pokemon') {
    return {
      pokemon: new Map([[placement.sheetSlug, { ...sheet, slug: placement.sheetSlug } as CharacterSheet]]),
      trainer: new Map(),
    }
  }

  return {
    pokemon: new Map(),
    trainer: new Map([[placement.sheetSlug, { ...sheet, slug: placement.sheetSlug } as TrainerSheet]]),
  }
}

const sendOutSheetLookup = (
  trainerPlacement: Pick<SheetPlacement, 'sheetSlug'>,
  trainerSheet: Record<string, unknown>,
  pokemonSlug: string,
  pokemonSheet: Record<string, unknown>,
): SheetLookup => ({
  pokemon: new Map([[pokemonSlug, { ...pokemonSheet, slug: pokemonSlug } as CharacterSheet]]),
  trainer: new Map([[trainerPlacement.sheetSlug, { ...trainerSheet, slug: trainerPlacement.sheetSlug } as TrainerSheet]]),
})

const spawnedForPlacement = (
  placement: SheetPlacement,
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
): SpawnedPokemon | null => {
  const record = readSheet(placement.sheetKind, placement.sheetSlug)
  if (!record) return null
  return placementToSpawned(placement, typedSheetLookupForPlacement(placement, record.sheet))
}

const footprintForExistingPlacement = (
  placement: SheetPlacement,
  readSheet: NonNullable<MapTokenActionDependencies['readSheet']>,
): Pick<SpawnedPokemon, 'id' | 'base' | 'clearance' | 'position'> => {
  const spawned = spawnedForPlacement(placement, readSheet)
  if (spawned) return spawned
  return {
    id: placement.id,
    base: 1,
    clearance: 1,
    position: placement.position,
  }
}

const trainerOwnsCurrentTeamPokemon = (trainerSheet: Record<string, unknown>, pokemonSlug: string): boolean => (
  Array.isArray(trainerSheet.currentTeam)
  && trainerSheet.currentTeam.some((value) => typeof value === 'string' && value.trim() === pokemonSlug)
)

const trainerOwnsRosterPokemon = (trainerSheet: Record<string, unknown>, pokemonSlug: string): boolean => (
  trainerOwnsCurrentTeamPokemon(trainerSheet, pokemonSlug)
  || (Array.isArray(trainerSheet.boxedPokemon)
    && trainerSheet.boxedPokemon.some((value) => typeof value === 'string' && value.trim() === pokemonSlug))
)

const normalizeLivePlaySendOutPlacement = (
  payload: SendOutPokemonPayload,
  trainerPlacement: SheetPlacement,
): SheetPlacement => {
  const facing = payload.facing ?? DEFAULT_TOKEN_FACING_DIRECTION
  return {
    id: payload.tokenId,
    sheetKind: 'pokemon',
    sheetSlug: payload.pokemonSlug,
    position: clonePosition(payload.position),
    ...(trainerPlacement.sideId === undefined ? {} : { sideId: trainerPlacement.sideId }),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
  }
}

const resolveSendOutPokemonMapContext = (
  payload: SendOutPokemonPayload,
  context: ResolvedMapWriteContext,
  dependencies: Pick<MapTokenActionDependencySet, 'readSheet'>,
): ResolvedSendOutPokemonMapContext => {
  const trainerPlacement = context.map.placements.find((candidate) => candidate.id === payload.trainerId)
    ?? rejectLivePlayCommand('not-found', `Trainer token ${payload.trainerId} not found`)
  if (trainerPlacement.sheetKind !== 'trainer') {
    rejectLivePlayCommand('invalid', `Token ${payload.trainerId} is not a trainer token`)
  }
  const existingPlacement = context.map.placements.find((candidate) => (
    candidate.id === payload.tokenId
    || (candidate.sheetKind === 'pokemon' && candidate.sheetSlug === payload.pokemonSlug)
  ))
  if (existingPlacement) {
    rejectLivePlayCommand('conflict', `Placement ${payload.tokenId} already exists`, {
      currentRevision: normalizeRevision(context.map.revision),
      currentState: existingPlacement,
    })
  }

  const trainerRecord = dependencies.readSheet('trainer', trainerPlacement.sheetSlug)
    ?? rejectLivePlayCommand('not-found', `trainer sheet ${trainerPlacement.sheetSlug} not found`)
  const pokemonRecord = dependencies.readSheet('pokemon', payload.pokemonSlug)
    ?? rejectLivePlayCommand('not-found', `pokemon sheet ${payload.pokemonSlug} not found`)
  const pokemonSheet = { ...pokemonRecord.sheet, slug: payload.pokemonSlug } as unknown as CharacterSheet
  if (pokemonSheet.letterPressCombinedInto) {
    rejectLivePlayCommand('conflict', `Pokémon ${payload.pokemonSlug} is irreversibly combined into Prime Unown ${pokemonSheet.letterPressCombinedInto.ownerSheetSlug}`)
  }
  if (pokemonSheet.zygardeDisassembledIntoCells) {
    rejectLivePlayCommand('conflict', `Zygarde ${payload.pokemonSlug} was irreversibly disassembled into Cells`)
  }
  if (!trainerOwnsCurrentTeamPokemon(trainerRecord.sheet, payload.pokemonSlug)) {
    rejectLivePlayCommand('conflict', `Trainer ${trainerPlacement.sheetSlug} does not have Pokémon ${payload.pokemonSlug} on their current team`)
  }
  const rosterSlugs = [...new Set([
    ...(Array.isArray(trainerRecord.sheet.currentTeam)
      ? trainerRecord.sheet.currentTeam.filter((slug): slug is string => typeof slug === 'string') : []),
    ...(Array.isArray(trainerRecord.sheet.boxedPokemon)
      ? trainerRecord.sheet.boxedPokemon.filter((slug): slug is string => typeof slug === 'string') : []),
  ])]
  const relationship = resolveMarsupialRelationship({
    subjectSlug: payload.pokemonSlug,
    pokemonBySlug: marsupialPokemonCandidates({
      subject: pokemonSheet,
      map: context.map,
      readSheet: dependencies.readSheet,
      additionalSlugs: rosterSlugs,
      authoritativeSheets: context.authoritativeSheets,
    }),
  })
  if (relationship.status === 'corrupt') rejectLivePlayCommand('conflict', relationship.message)

  const placement = normalizeLivePlaySendOutPlacement(payload, trainerPlacement)
  const abilityIds = effectiveRuntimeAbilityIds({ map: context.map, placement, sheet: pokemonSheet })
  if (pokemonMarsupialBabyActionRestricted(pokemonSheet, abilityIds)
    || (relationship.status === 'valid' && relationship.subjectRole === 'baby'
      && !abilityIds.includes('Parental Bond'))) {
    const motherSlug = relationship.status === 'valid' ? relationship.pouch.motherSheetSlug : 'its authoritative mother'
    rejectLivePlayCommand('conflict', `Baby-Template Kangaskhan ${payload.pokemonSlug} must be sent out with ${motherSlug}`)
  }

  const marsupialRelationship = relationship.status === 'valid' ? relationship : null
  let marsupialBaby: ResolvedSendOutPokemonMapContext['marsupialBaby'] = null
  if (marsupialRelationship?.subjectRole === 'mother') {
    const babySheet = marsupialRelationship.baby
    const existingBabyPlacement = context.map.placements.find(candidate => (
      candidate.sheetKind === 'pokemon' && candidate.sheetSlug === babySheet.slug
    ))
    const prospectiveBabyPlacement: SheetPlacement = existingBabyPlacement ?? {
      ...placement,
      id: `${payload.tokenId.slice(0, 100)}-marsupial-baby`,
      sheetSlug: babySheet.slug,
    }
    const parentalBondActive = effectiveRuntimeAbilityIds({
      map: context.map,
      placement: prospectiveBabyPlacement,
      sheet: babySheet,
    }).includes('Parental Bond')
    if (existingBabyPlacement && !parentalBondActive) {
      rejectLivePlayCommand('conflict', 'The authoritative Marsupial mother/baby pair cannot be deployed together')
    }
    if (!existingBabyPlacement && !parentalBondActive) {
      if (!trainerOwnsRosterPokemon(trainerRecord.sheet, babySheet.slug)) {
        rejectLivePlayCommand('conflict', 'The authoritative Marsupial mother/baby pair cannot be deployed together')
      }
      if (context.map.placements.some(candidate => candidate.id === prospectiveBabyPlacement.id)) {
        rejectLivePlayCommand('conflict', `Marsupial baby placement ${prospectiveBabyPlacement.id} already exists`)
      }
      marsupialBaby = { placement: prospectiveBabyPlacement, sheet: babySheet }
    }
  }
  const lookup = sendOutSheetLookup(trainerPlacement, trainerRecord.sheet, payload.pokemonSlug, pokemonRecord.sheet)
  if (marsupialBaby) lookup.pokemon.set(marsupialBaby.sheet.slug, marsupialBaby.sheet)
  const trainerToken = placementToSpawned(trainerPlacement, lookup)
    ?? rejectLivePlayCommand('conflict', `Trainer ${trainerPlacement.sheetSlug} or Pokémon ${payload.pokemonSlug} could not resolve a map footprint`)
  const pokemonToken = placementToSpawned(placement, lookup)
    ?? rejectLivePlayCommand('conflict', `Trainer ${trainerPlacement.sheetSlug} or Pokémon ${payload.pokemonSlug} could not resolve a map footprint`)

  const occupiedKeys = buildVoxelOccupancy(context.map.voxels)
  const existingFootprints = context.map.placements.map((currentPlacement) => footprintForExistingPlacement(
    currentPlacement,
    dependencies.readSheet,
  ))
  if (!canPlacePokemon(
    pokemonToken,
    placement.position,
    existingFootprints,
    context.map.dimensions,
    null,
    occupiedKeys,
  )) {
    rejectLivePlayCommand(
      'conflict',
      `Pokémon ${payload.pokemonSlug} cannot be sent out at ${placement.position.x},${placement.position.y},${placement.position.z}; the destination is out of bounds, blocked, or occupied`,
    )
  }
  if (!isSendOutPositionWithinThrowRange({
    trainer: trainerToken,
    pokemon: pokemonToken,
    position: placement.position,
    range: trainerThrowingRangeMeters(trainerRecord.sheet as unknown as TrainerSheet),
  })) {
    rejectLivePlayCommand(
      'conflict',
      `Pokémon ${payload.pokemonSlug} cannot be sent out at ${placement.position.x},${placement.position.y},${placement.position.z}; the destination is outside the trainer's Poké Ball throw range`,
    )
  }

  return {
    trainerPlacement,
    placement,
    trainerSheet: trainerRecord.sheet as unknown as TrainerSheet,
    pokemonSheet,
    trainerToken,
    pokemonToken,
    marsupialRelationship,
    marsupialBaby,
  }
}

const presenceEventId = (kind: 'recall' | 'send-out', operationId: string, placementId: string): string => (
  `event.${kind}.${createHash('sha256').update(`${operationId}\u0000${placementId}`).digest('hex').slice(0, 32)}`
)

const indexPokemonPresenceEvent = (
  map: TabletopMap,
  event: EncounterRecallEvent | EncounterSendOutEvent,
): TabletopMap => {
  const encounter = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return {
    ...map,
    encounterState: parseEncounterState({
      ...encounter,
      history: reduceEncounterHistoryEvent(encounter.history, event),
    }),
  }
}

const applySendOutPokemonToMap = (
  payload: SendOutPokemonPayload,
  context: ResolvedMapWriteContext,
  dependencies: Pick<MapTokenActionDependencySet, 'readSheet'>,
  operationId: string,
): AppliedMapTokenChange => {
  const resolved = resolveSendOutPokemonMapContext(payload, context, dependencies)
  let placedMap: TabletopMap = {
    ...context.map,
    placements: [
      ...context.map.placements,
      resolved.placement,
      ...(resolved.marsupialBaby ? [resolved.marsupialBaby.placement] : []),
    ],
  }
  try {
    placedMap = rebindZygardeAssemblyOnPresence({
      map: placedMap,
      placement: resolved.placement,
      sheet: resolved.pokemonSheet,
      pokemonSheets: new Map([[resolved.pokemonSheet.slug, resolved.pokemonSheet]]),
      trainerSheets: new Map([[resolved.trainerSheet.slug, resolved.trainerSheet]]),
      now: Math.max(0, context.map.updatedAt ?? 0),
      operationId,
    })
  }
  catch (error) {
    rejectLivePlayCommand('conflict', error instanceof Error ? error.message : 'Zygarde assembly authority could not be restored')
  }
  if (resolved.marsupialBaby) {
    const sheets = {
      pokemon: new Map([
        [resolved.pokemonSheet.slug, resolved.pokemonSheet],
        [resolved.marsupialBaby.sheet.slug, resolved.marsupialBaby.sheet],
      ]),
      trainer: new Map([[resolved.trainerSheet.slug, resolved.trainerSheet]]),
    }
    const source = resolveEffectiveCapabilities({
      map: placedMap,
      placement: resolved.placement,
      sheet: resolved.pokemonSheet,
      sheets,
    }).instances.find(instance => instance.effective && instance.canonicalId === 'Marsupial')
    if (!source) rejectLivePlayCommand('conflict', 'The Marsupial mother Capability source is not currently effective')
    const sourceInstance = source!
    const encounter = parseEncounterState(placedMap.encounterState ?? createEmptyEncounterState())
    const link = {
      id: `capability.link.${resolved.placement.id}.marsupial-pouch`,
      kind: 'marsupial-pouch' as const,
      ownerPlacementId: resolved.placement.id,
      participantPlacementIds: [resolved.marsupialBaby.placement.id],
      capabilityInstanceId: sourceInstance.instanceId,
      canonicalId: sourceInstance.canonicalId,
      establishedAt: Math.max(0, context.map.updatedAt ?? 0),
      configurationId: `experience-share:${resolved.marsupialRelationship!.pouch.experienceSharePercent}`,
      sourceOperationId: operationId,
    }
    const capabilityRuntime = parseCapabilityRuntimeState({
      ...encounter.capabilityRuntime,
      links: [...encounter.capabilityRuntime!.links.filter(entry => (
        entry.ownerPlacementId !== resolved.placement.id && !entry.participantPlacementIds.includes(resolved.marsupialBaby!.placement.id)
      )), link],
    })
    const pouches = Array.isArray(placedMap.metadata?.capabilityMarsupialPouches)
      ? placedMap.metadata.capabilityMarsupialPouches as unknown[] : []
    placedMap = {
      ...placedMap,
      encounterState: parseEncounterState({ ...encounter, capabilityRuntime }),
      metadata: {
        ...(placedMap.metadata ?? {}),
        capabilityMarsupialPouches: [...pouches.filter(raw => {
          const pouch = raw as Record<string, unknown>
          return pouch?.motherPlacementId !== resolved.placement.id
            && pouch?.babyPlacementId !== resolved.marsupialBaby!.placement.id
        }), {
          motherPlacementId: resolved.placement.id,
          babyPlacementId: resolved.marsupialBaby.placement.id,
          motherSheetSlug: resolved.marsupialRelationship!.pouch.motherSheetSlug,
          babySheetSlug: resolved.marsupialRelationship!.pouch.babySheetSlug,
          experienceSharePercent: resolved.marsupialRelationship!.pouch.experienceSharePercent,
          capabilityInstanceId: sourceInstance.instanceId,
          sourceOperationId: operationId,
        }],
      },
    }
  }
  const readPokemonSheet = (slug: string): CharacterSheet | null => (
    dependencies.readSheet('pokemon', slug)?.sheet as unknown as CharacterSheet ?? null
  )
  const withBallFetch = applyAa061BallFetchSendOutTriggers({
    mapBefore: context.map,
    mapAfter: placedMap,
    releasedPlacementId: resolved.placement.id,
    operationId,
    readPokemonSheet,
  })
  const triggeredMap = applyAa065CuriousMedicineSendOutTrigger({
    mapAfter: withBallFetch,
    releasedPlacementId: resolved.placement.id,
    operationId,
    readPokemonSheet,
  })
  const event = parseEncounterEvent({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: presenceEventId('send-out', operationId, resolved.placement.id),
    kind: 'send-out',
    sourceOperationId: operationId,
    causalParentEventId: null,
    reasonCode: 'live-play.pokemon-send-out',
    placementId: resolved.placement.id,
    sideId: resolved.placement.sideId ?? null,
    causalProviderId: null,
  }) as EncounterSendOutEvent
  return {
    nextMap: indexPokemonPresenceEvent(triggeredMap, event),
    placement: resolved.placement,
    ...(resolved.marsupialBaby ? {
      additionalPlacementChanges: [{
        placement: resolved.marsupialBaby.placement,
        previous: null,
        current: resolved.marsupialBaby.placement,
      }],
    } : {}),
  }
}

const applyDeleteTokenToMap = (
  payload: DeleteTokenPayload,
  context: ResolvedMapWriteContext,
  dependencies: Pick<MapTokenActionDependencySet, 'readSheet'>,
  operationId: string,
): AppliedMapTokenChange => {
  const placement = context.map.placements.find((candidate) => candidate.id === payload.placementId)
  if (!placement) throw new MapTokenActionUseCaseError(404, `Placement ${payload.placementId} not found`)

  let authoritativeMarsupialPlacementIds: ReadonlySet<string> | undefined
  if (placement.sheetKind === 'pokemon') {
    const record = dependencies.readSheet('pokemon', placement.sheetSlug)
      ?? rejectLivePlayCommand('conflict', `Pokémon sheet ${placement.sheetSlug} is unavailable for authoritative recall`)
    const sheet = { ...record.sheet, slug: placement.sheetSlug } as unknown as CharacterSheet
    const relationship = resolveMarsupialRelationship({
      subjectSlug: placement.sheetSlug,
      pokemonBySlug: marsupialPokemonCandidates({
        subject: sheet,
        map: context.map,
        readSheet: dependencies.readSheet,
        authoritativeSheets: context.authoritativeSheets,
      }),
    })
    if (relationship.status === 'corrupt') rejectLivePlayCommand('conflict', relationship.message)
    if (relationship.status === 'valid') {
      const babyPlacement = context.map.placements.find(candidate => (
        candidate.sheetKind === 'pokemon' && candidate.sheetSlug === relationship.pouch.babySheetSlug
      ))
      const parentalBondActive = babyPlacement
        ? effectiveRuntimeAbilityIds({ map: context.map, placement: babyPlacement, sheet: relationship.baby }).includes('Parental Bond')
        : false
      if (!parentalBondActive) {
        authoritativeMarsupialPlacementIds = marsupialRelationshipPlacementIds(context.map, relationship)
      }
    }
  }

  const removal = removeCapabilityPresenceGroup({
    map: context.map,
    ownerPlacementId: payload.placementId,
    authoritativeMarsupialPlacementIds,
  })
  const companions = context.map.placements.filter(candidate => (
    candidate.id !== placement.id && removal.removedPlacementIds.has(candidate.id)
  ))
  const nextMap = placement.sheetKind === 'pokemon'
    ? indexPokemonPresenceEvent(removal.map, parseEncounterEvent({
        schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
        eventId: presenceEventId('recall', operationId, placement.id),
        kind: 'recall',
        sourceOperationId: operationId,
        causalParentEventId: null,
        reasonCode: 'live-play.pokemon-recall',
        placementId: placement.id,
        sideId: placement.sideId ?? null,
        causalProviderId: null,
      }) as EncounterRecallEvent)
    : removal.map
  return {
    nextMap,
    placement,
    ...(companions.length > 0 ? {
      additionalPlacementChanges: companions.map(companion => ({
        placement: companion,
        previous: companion,
        current: null,
      })),
    } : {}),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isFiniteCoordinate = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const expectMoveTokenPayload = (payload: unknown): MoveTokenPayload => {
  if (!isRecord(payload)) {
    rejectLivePlayCommand('invalid', 'moveToken payload must be an object')
  }
  const record = payload as Record<string, unknown>
  const placementId = record.placementId
  const position = record.position
  const pathLength = record.pathLength
  const movementPolicy = record.movementPolicy

  if (typeof placementId !== 'string' || placementId.trim().length === 0) {
    rejectLivePlayCommand('invalid', 'moveToken payload.placementId is required')
  }
  if (!isRecord(position)) {
    rejectLivePlayCommand('invalid', 'moveToken payload.position must be an object')
  }
  const positionRecord = position as Record<string, unknown>
  const x = positionRecord.x
  const y = positionRecord.y
  const z = positionRecord.z
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || !Number.isSafeInteger(z)
    || (x as number) < 0
    || (y as number) < 0
    || (z as number) < 0
  ) {
    rejectLivePlayCommand('invalid', 'moveToken payload.position coordinates must be safe non-negative integers')
  }
  if (
    pathLength !== undefined
    && pathLength !== null
    && (typeof pathLength !== 'number' || !Number.isFinite(pathLength) || pathLength < 0)
  ) {
    rejectLivePlayCommand('invalid', 'moveToken payload.pathLength must be a non-negative finite number')
  }
  if (
    movementPolicy !== undefined
    && !isMoveTokenMovementPolicy(movementPolicy)
  ) {
    rejectLivePlayCommand('invalid', 'moveToken payload.movementPolicy must be standard or gm-override')
  }

  return {
    placementId: placementId as string,
    position: {
      x: x as number,
      y: y as number,
      z: z as number,
    },
    ...(pathLength === undefined ? {} : { pathLength: pathLength as number | null }),
    ...(isMoveTokenMovementPolicy(movementPolicy) ? { movementPolicy } : {}),
  }
}

const expectTurnTokenPayload = (payload: unknown): TurnTokenPayload => {
  if (!isRecord(payload)) {
    rejectLivePlayCommand('invalid', 'turnToken payload must be an object')
  }
  const record = payload as Record<string, unknown>
  const placementId = record.placementId
  const facing = record.facing

  if (typeof placementId !== 'string' || placementId.trim().length === 0) {
    rejectLivePlayCommand('invalid', 'turnToken payload.placementId is required')
  }
  if (!isTokenFacingDirection(facing)) {
    rejectLivePlayCommand('invalid', 'turnToken payload.facing must be a token facing direction')
  }

  return {
    placementId: placementId as string,
    facing: facing as TokenFacingDirection,
  }
}

const nonEmptyCommandString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const expectSpawnTokenPayload = (payload: unknown): SpawnTokenPayload => {
  if (!isRecord(payload)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload must be an object')
  }
  const placementInput = (payload as Record<string, unknown>).placement
  if (!isRecord(placementInput)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement must be an object')
  }
  const placementRecord = placementInput as Record<string, unknown>
  const id = placementRecord.id
  const sheetKind = placementRecord.sheetKind
  const sheetSlug = placementRecord.sheetSlug
  const position = placementRecord.position
  const sideId = placementRecord.sideId
  const facing = placementRecord.facing
  const turned = placementRecord.turned
  const initiative = placementRecord.initiative

  if (!nonEmptyCommandString(id)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.id is required')
  }
  if ((id as string).length > 120) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.id must be at most 120 characters')
  }
  if (!isSheetKind(sheetKind)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.sheetKind must be pokemon or trainer')
  }
  if (!nonEmptyCommandString(sheetSlug)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.sheetSlug is required')
  }
  if ((sheetSlug as string).length > 200) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.sheetSlug must be at most 200 characters')
  }
  if (!isRecord(position)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.position must be an object')
  }
  const positionRecord = position as Record<string, unknown>
  const x = positionRecord.x
  const y = positionRecord.y
  const z = positionRecord.z
  if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y) || !isFiniteCoordinate(z)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.position coordinates must be finite numbers')
  }
  if (sideId !== undefined && !isEncounterSideId(sideId)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.sideId must be a valid encounter side ID when provided')
  }
  if (facing !== undefined && !isTokenFacingDirection(facing)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.facing must be a token facing direction')
  }
  if (turned !== undefined && typeof turned !== 'boolean') {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.turned must be a boolean when provided')
  }
  if (initiative !== undefined && initiative !== null && !Number.isSafeInteger(initiative)) {
    rejectLivePlayCommand('invalid', 'spawnToken payload.placement.initiative must be a safe integer or null when provided')
  }

  return {
    placement: {
      id: (id as string).trim(),
      sheetKind: sheetKind as SheetKind,
      sheetSlug: (sheetSlug as string).trim(),
      position: { x: x as number, y: y as number, z: z as number },
      ...(isEncounterSideId(sideId) ? { sideId } : {}),
      ...(isTokenFacingDirection(facing) ? { facing } : {}),
      ...(typeof turned === 'boolean' ? { turned } : {}),
      ...(initiative === undefined ? {} : { initiative: initiative as number | null }),
    },
  }
}

const expectSendOutPokemonPayload = (payload: unknown): SendOutPokemonPayload => {
  if (!isRecord(payload)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload must be an object')
  }
  const record = payload as Record<string, unknown>
  const trainerId = record.trainerId
  const pokemonSlug = record.pokemonSlug
  const tokenId = record.tokenId
  const position = record.position
  const facing = record.facing

  if (!nonEmptyCommandString(trainerId)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.trainerId is required')
  }
  if ((trainerId as string).length > 120) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.trainerId must be at most 120 characters')
  }
  if (!nonEmptyCommandString(pokemonSlug)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.pokemonSlug is required')
  }
  if ((pokemonSlug as string).length > 200) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.pokemonSlug must be at most 200 characters')
  }
  if (!nonEmptyCommandString(tokenId)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.tokenId is required')
  }
  if ((tokenId as string).length > 120) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.tokenId must be at most 120 characters')
  }
  if ((tokenId as string).trim() === (trainerId as string).trim()) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.tokenId must be different from payload.trainerId')
  }
  if (!isRecord(position)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.position must be an object')
  }
  const positionRecord = position as Record<string, unknown>
  const x = positionRecord.x
  const y = positionRecord.y
  const z = positionRecord.z
  if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y) || !isFiniteCoordinate(z)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.position coordinates must be finite numbers')
  }
  if (facing !== undefined && !isTokenFacingDirection(facing)) {
    rejectLivePlayCommand('invalid', 'sendOutPokemon payload.facing must be a token facing direction')
  }

  return {
    trainerId: (trainerId as string).trim(),
    pokemonSlug: (pokemonSlug as string).trim(),
    tokenId: (tokenId as string).trim(),
    position: { x: x as number, y: y as number, z: z as number },
    ...(isTokenFacingDirection(facing) ? { facing } : {}),
  }
}

const expectDeleteTokenPayload = (payload: unknown): DeleteTokenPayload => {
  if (!isRecord(payload)) {
    rejectLivePlayCommand('invalid', 'deleteToken payload must be an object')
  }
  const placementId = (payload as Record<string, unknown>).placementId
  if (!nonEmptyCommandString(placementId)) {
    rejectLivePlayCommand('invalid', 'deleteToken payload.placementId is required')
  }
  if ((placementId as string).length > 120) {
    rejectLivePlayCommand('invalid', 'deleteToken payload.placementId must be at most 120 characters')
  }
  return { placementId: (placementId as string).trim() }
}

const tokenScopeMatches = (
  scopes: readonly LivePlayTokenScope[],
  placementId: string,
  field: LivePlayTokenScope['field'],
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === field
))

const expectCommandPayloadAndScope = (
  command: MapTokenLivePlayCommand,
): MoveTokenPayload | TurnTokenPayload | SpawnTokenPayload | SendOutPokemonPayload | DeleteTokenPayload => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
    const payload = expectMoveTokenPayload(command.payload)
    if (!tokenScopeMatches(command.scopes, payload.placementId, 'position')) {
      rejectLivePlayCommand('invalid', 'moveToken scopes must include the token position scope for payload.placementId')
    }
    return payload
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) {
    const payload = expectTurnTokenPayload(command.payload)
    if (!tokenScopeMatches(command.scopes, payload.placementId, 'facing')) {
      rejectLivePlayCommand('invalid', 'turnToken scopes must include the token facing scope for payload.placementId')
    }
    return payload
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN) {
    const payload = expectSpawnTokenPayload(command.payload)
    if (!tokenScopeMatches(command.scopes, payload.placement.id, 'spawn')) {
      rejectLivePlayCommand('invalid', 'spawnToken scopes must include the token spawn scope for payload.placement.id')
    }
    return payload
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON) {
    const payload = expectSendOutPokemonPayload(command.payload)
    if (!tokenScopeMatches(command.scopes, payload.trainerId, 'sendOut')) {
      rejectLivePlayCommand('invalid', 'sendOutPokemon scopes must include the trainer token sendOut scope for payload.trainerId')
    }
    if (!tokenScopeMatches(command.scopes, payload.tokenId, 'spawn')) {
      rejectLivePlayCommand('invalid', 'sendOutPokemon scopes must include the spawned token scope for payload.tokenId')
    }
    return payload
  }

  const payload = expectDeleteTokenPayload(command.payload)
  if (!tokenScopeMatches(command.scopes, payload.placementId, 'delete')) {
    rejectLivePlayCommand('invalid', 'deleteToken scopes must include the token delete scope for payload.placementId')
  }
  return payload
}

const commandPlacementId = (command: MapTokenLivePlayCommand): string => {
  const payload = expectCommandPayloadAndScope(command)
  if ('placement' in payload) return payload.placement.id
  if ('tokenId' in payload) return payload.tokenId
  return payload.placementId
}

const latestMetadataEntry = (
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined => {
  const entries = metadata?.[key]
  const entry = Array.isArray(entries) ? entries.at(-1) : undefined
  return isRecord(entry) ? entry : undefined
}

const commandPatch = (
  command: MapTokenLivePlayCommand,
  revision: number,
  change: AppliedMapTokenChange,
): LivePlayPatch => {
  const placement = change.placement
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
    const movementLogEntry = latestMetadataEntry(change.nextMap.metadata, 'movementLog')
    return {
      schemaVersion: command.schemaVersion,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      mapSlug: command.mapSlug,
      revision,
      scopes: command.scopes,
      payload: {
        placementId: placement.id,
        position: placement.position,
        ...(placement.facing === undefined ? {} : { facing: placement.facing }),
        ...(placement.turned === undefined ? {} : { turned: placement.turned }),
        ...(movementLogEntry === undefined ? {} : { movementLogEntry }),
        ...(change.turnResources === undefined
          ? {}
          : { turnResources: change.turnResources }),
      },
    }
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) {
    return {
      schemaVersion: command.schemaVersion,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
      mapSlug: command.mapSlug,
      revision,
      scopes: command.scopes,
      payload: {
        placementId: placement.id,
        facing: placement.facing,
        turned: placement.turned,
      },
    }
  }

  const isPlacementCreate = command.type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
    || command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON

  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
    mapSlug: command.mapSlug,
    revision,
    scopes: command.scopes,
    payload: {
      command: command.type,
      placementId: placement.id,
      ...(command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON ? { trainerId: command.payload.trainerId } : {}),
      previous: command.type === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN ? placement : null,
      current: isPlacementCreate ? placement : null,
      ...((command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
        || command.type === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN && placement.sheetKind === 'pokemon')
        ? { currentEncounterState: change.nextMap.encounterState ?? createEmptyEncounterState() }
        : {}),
    },
  }
}

const additionalPlacementPatches = (
  command: MapTokenLivePlayCommand,
  revision: number,
  change: AppliedMapTokenChange,
): readonly LivePlayPatch[] => (change.additionalPlacementChanges ?? []).map(entry => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
  mapSlug: command.mapSlug,
  revision,
  scopes: [{
    kind: 'token',
    placementId: entry.placement.id,
    field: entry.current ? 'spawn' : 'delete',
  }],
  payload: {
    command: command.type,
    placementId: entry.placement.id,
    ...(command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON ? { trainerId: command.payload.trainerId } : {}),
    previous: entry.previous,
    current: entry.current,
  },
}))

const movementZoneHpPatches = (
  command: MoveTokenLivePlayCommand,
  revision: number,
  zonePlan: PlannedBattlefieldZoneMovement | null,
): readonly LivePlayPatch[] => {
  if (!zonePlan) return []
  const byRecipient = new Map<string, {
    readonly previous: Record<string, unknown>
    readonly current: Record<string, unknown>
  }>()
  for (const result of zonePlan.coreOperationResults) {
    for (const recipient of result.recipients) {
      if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') continue
      if (
        recipient.previous.currentHp === recipient.current.currentHp
        && recipient.previous.temporaryHp === recipient.current.temporaryHp
        && recipient.previous.injuries === recipient.current.injuries
      ) continue
      const existing = byRecipient.get(recipient.recipientId)
      byRecipient.set(recipient.recipientId, {
        previous: existing?.previous ?? { ...recipient.previous },
        current: { ...recipient.current },
      })
    }
  }
  return [...byRecipient.entries()].flatMap(([placementId, hp]) => {
    const placement = zonePlan.nextMap.placements.find(candidate => candidate.id === placementId)
    if (!placement) return []
    const write = zonePlan.sheetWrites.find(candidate => (
      candidate.kind === placement.sheetKind && candidate.slug === placement.sheetSlug
    ))
    return [{
      schemaVersion: command.schemaVersion,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
      mapSlug: command.mapSlug,
      revision,
      scopes: [
        { kind: 'token', placementId, field: 'hp' },
        {
          kind: 'sheet', sheetKind: placement.sheetKind,
          sheetSlug: placement.sheetSlug, field: 'hp',
        },
      ],
      payload: {
        placementId,
        sheetKind: placement.sheetKind,
        sheetSlug: placement.sheetSlug,
        previous: hp.previous,
        current: hp.current,
        previousTemporaryHp: hp.previous.temporaryHp,
        currentTemporaryHp: hp.current.temporaryHp,
        sheetRevision: write?.revision ?? normalizeRevision(
          zonePlan.sheetReads.find(read => (
            read.kind === placement.sheetKind && read.slug === placement.sheetSlug
          ))?.revision,
        ),
      },
    } satisfies LivePlayPatch]
  })
}

const persistedCommandResponse = (
  result: LivePlayCommandResult,
  context: ResolvedMapTokenCommandResponseContext | null,
): MapTokenLivePlayCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    placement: context.placement,
  } : {}),
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const placementIdFromPlacementPatch = (result: LivePlayCommandAccepted): string | null => {
  const patch = result.patches.find((candidate) => candidate.type === LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS)
  if (!patch || !isRecord(patch.payload)) return null
  const placementId = (patch.payload as Record<string, unknown>).placementId
  return nonEmptyCommandString(placementId) ? placementId : null
}

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  placementIdFromPlacementPatch(result)
  ?? result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId
  ?? null
)

const isSheetPlacementLike = (value: unknown): value is SheetPlacement => {
  if (!isRecord(value)) return false
  const record = value as Record<string, unknown>
  return nonEmptyCommandString(record.id)
    && isSheetKind(record.sheetKind)
    && nonEmptyCommandString(record.sheetSlug)
    && isRecord(record.position)
    && (record.sideId === undefined || isEncounterSideId(record.sideId))
}

const placementFromPlacementPatch = (result: LivePlayCommandAccepted): SheetPlacement | undefined => {
  const patch = result.patches.find((candidate) => candidate.type === LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS)
  if (!patch || !isRecord(patch.payload)) return undefined
  const payload = patch.payload as Record<string, unknown>
  if (isSheetPlacementLike(payload.current)) return payload.current
  if (isSheetPlacementLike(payload.previous)) return payload.previous
  return undefined
}

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: MapTokenActionDependencySet,
): Promise<ResolvedMapTokenCommandResponseContext | null> => {
  const placementId = placementIdFromAcceptedResult(result)

  try {
    const context = await resolveLivePlayMapWriteContext({ role, slug: result.mapSlug }, dependencies)
    const placement = placementId
      ? context.map.placements.find((candidate) => candidate.id === placementId) ?? placementFromPlacementPatch(result)
      : placementFromPlacementPatch(result)
    return placement ? { ...context, placement } : context
  } catch {
    return null
  }
}

interface SuspendedMovementApplication {
  readonly pendingResolution: PendingMoveResolution
  readonly change: AppliedMapTokenChange
  readonly result: PendingMoveDeclarationResult
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
  readonly sheetWrites: readonly AuthoritativeMoveSheetWritePlan[]
}

const movementPrefixThroughStep = (
  movement: AuthoritativeMovementSuccess,
  completedStepCount: number,
): AuthoritativeMovementSuccess | null => {
  const count = Math.max(0, Math.min(completedStepCount, movement.triggeringSteps.length))
  if (count === 0) return null
  const triggeringSteps = movement.triggeringSteps.slice(0, count).map((step, index) => ({
    ...step,
    finalDestination: index === count - 1,
  }))
  const destination = triggeringSteps.at(-1)!.to
  return {
    ...movement,
    destination: { ...destination },
    path: movement.path.slice(0, count + 1).map(cell => ({ ...cell })),
    cost: triggeringSteps.at(-1)!.cumulativeCost,
    triggeringSteps,
  }
}

const suspendMovementForOpportunityAttack = (input: {
  readonly command: MoveTokenLivePlayCommand
  readonly resolved: ResolvedNormalTokenMovement
  readonly context: ResolvedMapTokenActionContext
  readonly currentRevision: number
  readonly dependencies: MapTokenActionDependencySet
}): SuspendedMovementApplication | null => {
  if (!input.dependencies.pendingResolutionRepository) return null
  const commandHash = createLivePlayCommandHash(input.command)
  const identity = movementAttackOfOpportunityPersistenceIdentity({
    mapSlug: input.command.mapSlug,
    originOpId: parseLivePlayOpId(input.command.opId),
    commandHash,
  })
  const revision = nextRevision(input.currentRevision)
  const timestamp = input.dependencies.now()
  const materialized = materializeMovementAttackOfOpportunity({
    ...identity,
    originMapSlug: input.command.mapSlug,
    declarationPreviousRevision: input.currentRevision,
    continuationMapRevision: revision,
    createdAt: timestamp,
    map: input.context.map,
    movement: input.resolved.movement,
    pokemonSheets: input.resolved.sheets.pokemon,
    trainerSheets: input.resolved.sheets.trainer,
    playerCharacterSheetKeys: playerCharacterSheetKeysForProfiles(
      input.dependencies.listProfiles(),
    ),
  })
  if (!materialized) return null

  const resources = planAuthoritativeMovementResources({
    map: input.context.map,
    movement: input.resolved.movement,
    sourceOperationId: input.command.opId,
    distance: materialized.committedCost,
    spendAction: true,
  })
  const resourceMap: TabletopMap = {
    ...resources.nextMap,
    encounterState: resources.currentEncounterState,
  }
  const committedMovement = input.resolved.movement.policy.kind === 'standard'
    ? movementPrefixThroughStep(
        input.resolved.movement,
        materialized.lifecycle.completedStepCount,
      )
    : null
  const zonePlan = committedMovement
    ? planBattlefieldZoneMovement({
        map: resourceMap,
        pokemonSheets: input.resolved.sheets.pokemon,
        trainerSheets: input.resolved.sheets.trainer,
        movement: {
          movement: committedMovement,
          movementId: `movement:${input.command.opId}`,
          sourceOperationId: input.command.opId,
          mode: 'voluntary',
        },
        time: timestamp,
      })
    : null
  const transition = applyAuthoritativeMovementMapTransition({
    map: zonePlan?.nextMap ?? resourceMap,
    placementId: input.context.placement.id,
    destination: materialized.lifecycle.currentPosition,
    distance: materialized.committedCost,
    encounterState: zonePlan?.currentEncounterState ?? resources.currentEncounterState,
    timestamp,
    userName: sheetDisplayName(input.context.placement, input.dependencies.readSheet),
    linkedCompanionPlacementIds: input.resolved.movement.linkedCompanionPlacementIds,
    maxLogEntries: input.dependencies.maxMovementLogEntries,
    ...(committedMovement ? {
      movementEvidence: {
        operationId: input.command.opId,
        path: committedMovement.path,
        mode: 'voluntary' as const,
      },
    } : {}),
  })
  const encounter = parseEncounterState(
    transition.nextMap.encounterState ?? createEmptyEncounterState(),
  )
  const nextMap: TabletopMap = {
    ...transition.nextMap,
    encounterState: parseEncounterState({
      ...encounter,
      pendingResolutionSummaries: [
        ...encounter.pendingResolutionSummaries,
        materialized.pendingResolution.publicSummary,
      ],
    }),
    revision,
  }
  return {
    pendingResolution: materialized.pendingResolution,
    change: {
      nextMap,
      placement: transition.placement,
      timestamp,
      turnResources: {
        previous: parseEncounterState(
          input.context.map.encounterState ?? createEmptyEncounterState(),
        ).turnResources,
        current: (zonePlan?.currentEncounterState ?? resources.currentEncounterState).turnResources,
      },
    },
    result: createPendingMoveDeclarationResult({
      opId: input.command.opId,
      mapSlug: input.command.mapSlug,
      previousRevision: input.currentRevision,
      revision,
      pendingResolution: materialized.pendingResolution.publicSummary,
    }),
    sheetReads: zonePlan
      ? [...input.resolved.movement.sheetReads, ...zonePlan.sheetReads]
      : input.resolved.movement.sheetReads,
    sheetWrites: zonePlan?.sheetWrites ?? [],
  }
}

const pendingMovementResultFromStored = (input: {
  readonly command: MoveTokenLivePlayCommand
  readonly commandHash: LivePlayCommandHash
  readonly stored: StoredPendingMoveResolution
}): PendingMoveDeclarationResult => {
  if (!isPreStepMovementAttackOfOpportunity(input.stored.resolution)) {
    throw new MapTokenActionUseCaseError(
      409,
      'The movement operation identity belongs to another pending resolution.',
    )
  }
  const expected = movementAttackOfOpportunityPersistenceIdentity({
    mapSlug: input.command.mapSlug,
    originOpId: parseLivePlayOpId(input.command.opId),
    commandHash: input.commandHash,
  })
  const context = input.stored.resolution.continuationContext
  const payload = expectMoveTokenPayload(input.command.payload)
  const requestedPolicy = payload.movementPolicy ?? 'standard'
  if (
    input.stored.resolutionId !== expected.resolutionId
    || input.stored.originOpId !== input.command.opId
    || input.stored.status !== 'pending'
    || context.provokerPlacementId !== payload.placementId
    || context.movementPath.policy !== requestedPolicy
    || !positionsEqual(context.movementPath.requestedDestination, payload.position)
  ) {
    throw new MapTokenActionUseCaseError(
      409,
      'The movement operation ID already identifies different or terminal durable state.',
    )
  }
  return createPendingMoveDeclarationResult({
    opId: input.command.opId,
    mapSlug: input.command.mapSlug,
    previousRevision: context.movementPath.declarationPreviousRevision,
    revision: context.movementPath.declarationRevision,
    pendingResolution: input.stored.resolution.publicSummary,
  })
}

export const executeMapTokenLivePlayCommandUseCase = async (
  input: ExecuteMapTokenLivePlayCommandInput,
  dependencies: MapTokenActionDependencies = {},
): Promise<MapTokenLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedMapTokenCommandResponseContext | null = null
  let movementSheetReads: readonly AuthoritativeMovementSheetRead[] = []
  let movementSheetWrites: readonly AuthoritativeMoveSheetWritePlan[] = []
  let appliedMovementZonePlan: PlannedBattlefieldZoneMovement | null = null
  let suspendedMovement: SuspendedMovementApplication | null = null

  const result = await deps.commandExecutor.execute<MapTokenLivePlayCommand, ResolvedMapWriteContext, MapTokenLivePlayActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command }) => resolveLivePlayMapWriteContext({ role: input.role, slug: command.mapSlug }, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    findSuspendedResult: ({ command, commandHash }) => {
      if (!deps.pendingResolutionRepository) return null
      if (command.type !== LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) return null
      const stored = deps.pendingResolutionRepository.getByOrigin(command.mapSlug, command.opId)
      if (!stored) return null
      return pendingMovementResultFromStored({ command, commandHash, stored })
    },
    authorize: ({ command, actor, map }) => {
      if (input.expectedType && command.type !== input.expectedType) {
        rejectLivePlayCommand('invalid', `This route only accepts ${input.expectedType} commands`)
      }
      if (
        command.type !== LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
        && command.type !== LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
        && command.type !== LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
        && command.type !== LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
        && command.type !== LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
      ) {
        rejectLivePlayCommand('invalid', 'Map token live-play routes support moveToken, turnToken, spawnToken, sendOutPokemon, and deleteToken commands only')
      }

      if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
        const payload = expectMoveTokenPayload(command.payload)
        if (payload.movementPolicy === 'gm-override' && actor.role !== 'gm') {
          rejectLivePlayCommand('unauthorized', 'Only a GM can request the explicit movement override policy')
        }
      }

      if (command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON) {
        const payload = expectSendOutPokemonPayload(command.payload)
        if (!tokenScopeMatches(command.scopes, payload.trainerId, 'sendOut')) {
          rejectLivePlayCommand('invalid', 'sendOutPokemon scopes must include the trainer token sendOut scope for payload.trainerId')
        }
        if (!tokenScopeMatches(command.scopes, payload.tokenId, 'spawn')) {
          rejectLivePlayCommand('invalid', 'sendOutPokemon scopes must include the spawned token scope for payload.tokenId')
        }
        const trainerPlacement = map.map.placements.find((candidate) => candidate.id === payload.trainerId)
        if (!trainerPlacement) throw new MapTokenActionUseCaseError(404, `Trainer token ${payload.trainerId} not found`)
        if (trainerPlacement.sheetKind !== 'trainer') rejectLivePlayCommand('invalid', `Token ${payload.trainerId} is not a trainer token`)
        if (!actorCanControlMapPlacement({
          role: actor.role,
          profile: actor.playerProfile,
          placement: trainerPlacement,
          linkedTrainerSheets: linkedTrainerSheetsForActor(actor, deps),
        })) {
          const message = actor.role === 'player' && !actor.playerProfile
            ? 'Select a player profile to control linked map tokens'
            : 'Token is not linked to selected player profile'
          throw new MapTokenActionUseCaseError(403, message)
        }
        resolveSendOutPokemonMapContext(payload, map, deps)
        return
      }

      if (command.type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN) {
        if (actor.role !== 'gm') rejectLivePlayCommand('unauthorized', 'Only GMs can spawn map tokens')
        const payload = expectSpawnTokenPayload(command.payload)
        if (!tokenScopeMatches(command.scopes, payload.placement.id, 'spawn')) {
          rejectLivePlayCommand('invalid', 'spawnToken scopes must include the token spawn scope for payload.placement.id')
        }
        if (
          payload.placement.sideId !== undefined
          && !encounterStateHasSide(map.map.encounterState, payload.placement.sideId)
        ) {
          rejectLivePlayCommand('invalid', `spawnToken placement side ${payload.placement.sideId} is not defined on map ${map.map.slug}`)
        }
        if (!isPositionWithinMapBounds(payload.placement.position, map.map)) {
          rejectLivePlayCommand('invalid', `spawnToken placement ${payload.placement.id} position is outside map bounds`)
        }
        const existingPlacement = map.map.placements.find((candidate) => candidate.id === payload.placement.id)
        if (existingPlacement) {
          rejectLivePlayCommand('conflict', `Placement ${payload.placement.id} already exists`, {
            currentRevision: normalizeRevision(map.map.revision),
            currentState: existingPlacement,
          })
        }
        if (!deps.readSheet(payload.placement.sheetKind, payload.placement.sheetSlug)) {
          rejectLivePlayCommand('not-found', `${payload.placement.sheetKind} sheet ${payload.placement.sheetSlug} not found`)
        }
        return
      }

      const placementId = commandPlacementId(command)
      const placement = map.map.placements.find((candidate) => candidate.id === placementId)
      if (!placement) throw new MapTokenActionUseCaseError(404, `Placement ${placementId} not found`)

      if (command.type === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN) {
        if (actor.role !== 'gm') rejectLivePlayCommand('unauthorized', 'Only GMs can delete map tokens')
        return
      }

      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement,
        linkedTrainerSheets: linkedTrainerSheetsForActor(actor, deps),
      })) {
        const message = actor.role === 'player' && !actor.playerProfile
          ? 'Select a player profile to control linked map tokens'
          : 'Token is not linked to selected player profile'
        throw new MapTokenActionUseCaseError(403, message)
      }
    },
    apply: ({ command, actor, map, currentRevision }) => {
      const placementId = commandPlacementId(command)
      const existingPlacement = map.map.placements.find((candidate) => candidate.id === placementId)
      const context = existingPlacement ? { ...map, placement: existingPlacement } : null
      let change: AppliedMapTokenChange | null

      if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
        const payload = expectMoveTokenPayload(command.payload)
        const movement = context
          ? resolveNormalTokenMovement(
              payload,
              actor,
              context,
              currentRevision,
              command.opId,
              deps.readSheet,
            )
          : null
        movementSheetReads = movement
          ? [...movement.movement.sheetReads, ...(movement.zonePlan?.sheetReads ?? [])]
          : []
        movementSheetWrites = movement?.zonePlan?.sheetWrites ?? []
        appliedMovementZonePlan = movement?.zonePlan ?? null
        if (movement && context) {
          const suspended = suspendMovementForOpportunityAttack({
            command,
            resolved: movement,
            context,
            currentRevision,
            dependencies: deps,
          })
          if (suspended) {
            suspendedMovement = suspended
            movementSheetReads = suspended.sheetReads
            movementSheetWrites = suspended.sheetWrites
            return {
              status: 'suspended',
              nextMap: {
                mapPath: map.mapPath,
                relativePath: map.relativePath,
                map: suspended.change.nextMap,
              },
              result: suspended.result,
            }
          }
          change = applyResolvedMoveTokenToMap(movement, context, deps)
        } else {
          change = null
        }
      } else if (command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) {
        change = context ? applyTurnTokenToMap(expectTurnTokenPayload(command.payload), context) : null
      } else if (command.type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN) {
        change = applySpawnTokenToMap(expectSpawnTokenPayload(command.payload), map, deps, command.opId)
      } else if (command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON) {
        change = applySendOutPokemonToMap(expectSendOutPokemonPayload(command.payload), map, deps, command.opId)
      } else {
        change = applyDeleteTokenToMap(expectDeleteTokenPayload(command.payload), map, deps, command.opId)
      }

      if (!change) {
        if (!existingPlacement) throw new MapTokenActionUseCaseError(404, `Placement ${placementId} not found`)
        return {
          status: 'rejected',
          reason: 'no-op',
          message: `${command.type} did not change token ${placementId}`,
          currentRevision,
          currentState: existingPlacement,
        }
      }

      const revision = nextRevision(currentRevision)
      const nextMap = {
        ...change.nextMap,
        revision,
      }
      const nextContext: ResolvedMapWriteContext = {
        mapPath: map.mapPath,
        relativePath: map.relativePath,
        map: nextMap,
      }

      return {
        status: 'accepted',
        nextMap: nextContext,
        previousRevision: currentRevision,
        revision,
        patches: [
          commandPatch(command, revision, change),
          ...additionalPlacementPatches(command, revision, change),
          ...(command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
            ? movementZoneHpPatches(command, revision, appliedMovementZonePlan)
            : []),
        ],
      }
    },
    persist: () => {
      throw new Error('live-play map token commands must persist through the accepted-result commit hook')
    },
    commitSuspended: ({ command, currentRevision, nextMap, result }) => {
      const suspended = suspendedMovement
      if (!suspended || !deps.pendingResolutionRepository) {
        throw new MapTokenActionUseCaseError(
          409,
          'Suspended movement declaration has no durable pending resolution to persist',
        )
      }
      const persisted = toPersistedMap(
        nextMap.map,
        nextMap.map.folder ?? '',
        deps.now(),
        { revision: result.revision },
      )
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        validateBeforeWrite: () => assertMovementSheetReads(
          movementSheetReads,
          deps.readSheet,
          currentRevision,
        ),
        staleError: () => new MapTokenActionUseCaseError(
          409,
          `Map ${result.mapSlug} changed before the suspended movement could persist`,
        ),
        missingMapError: () => new MapTokenActionUseCaseError(
          404,
          `Map ${result.mapSlug}.json not found after suspended movement`,
        ),
        saveOpResult: () => {
          persistMovementSheetWrites(movementSheetWrites, deps.sheetRepository)
          const stored = deps.pendingResolutionRepository!.create({
            resolution: suspended.pendingResolution,
            declarationPlan: createMoveStateChangePlan([]),
          })
          if (
            stored.resolutionId !== suspended.pendingResolution.resolutionId
            || stored.status !== 'pending'
          ) {
            throw new MapTokenActionUseCaseError(
              409,
              'Suspended movement declaration did not persist its canonical pending identity',
            )
          }
        },
      })
      void command
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: authoritativeMap,
      }
    },
    commit: ({ actor, command, currentRevision, nextMap, result, saveOpResult }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.map.folder ?? '', deps.now(), { revision: result.revision })
      const placementId = placementIdFromAcceptedResult(result)
      let placement: SheetPlacement | undefined
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        ...(command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
          ? {
              validateBeforeWrite: () => assertMovementSheetReads(
                movementSheetReads,
                deps.readSheet,
                currentRevision,
              ),
            }
          : {}),
        staleError: () => new MapTokenActionUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`),
        missingMapError: () => new MapTokenActionUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play command`),
        saveOpResult: () => {
          persistMovementSheetWrites(movementSheetWrites, deps.sheetRepository)
          return saveOpResult()
        },
        verify: (authoritativeMap) => {
          placement = placementId
            ? authoritativeMap.placements.find((candidate) => candidate.id === placementId) ?? placementFromPlacementPatch(result)
            : placementFromPlacementPatch(result)
          if (!placement && command.type !== LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN) {
            throw new MapTokenActionUseCaseError(404, 'Token command applied but persisted placement was not found')
          }
        },
      })
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: authoritativeMap,
        ...(placement === undefined ? {} : { placement }),
      }
      void actor
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return persistedCommandResponse(result, responseContext)
}
