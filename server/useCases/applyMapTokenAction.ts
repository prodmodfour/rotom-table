import { join } from 'node:path'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type DeleteTokenLivePlayCommand,
  type DeleteTokenPayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayTokenScope,
  type MoveTokenLivePlayCommand,
  type MoveTokenPayload,
  type SendOutPokemonLivePlayCommand,
  type SendOutPokemonPayload,
  type SpawnTokenLivePlayCommand,
  type SpawnTokenPayload,
  type TurnTokenLivePlayCommand,
  type TurnTokenPayload,
} from '#shared/livePlayCommands'
import type { RealtimeEvent } from '#shared/realtime'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { isSheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'
import { canPlacePokemon } from '~/utils/gridPlacement'
import { appendMovementLogEntry, sameGridAnchor } from '~/utils/mapMovementLog'
import {
  isSendOutPositionWithinThrowRange,
  POKEBALL_THROW_RANGE_SQUARES,
} from '~/utils/mapTokenSendOut'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import {
  DEFAULT_TOKEN_FACING_DIRECTION,
  isTokenFacingDirection,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import { readSheetFile } from '../utils/sheetStorage'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { canAccessMapForRole, clampAnchorToDimensions } from '../policies/mapPolicy'
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
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { toPersistedMap } from './saveMap'

export class MapTokenActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface MoveMapTokenInput {
  role: AuthRole
  slug: string
  placementId: string
  position: GridAnchor
  clientId?: string
  playerProfile?: PlayerProfile | null
  pathLength?: number | null
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
  publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
}

interface ResolvedMapWriteContext {
  mapPath: string
  relativePath: string
  map: TabletopMap
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

const normalizedPathLength = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.max(0, Math.round(value))
}

const readDefaultSheet = (kind: SheetKind, slug: string): SheetFileRecord | null =>
  readSheetFile<Record<string, unknown>>(kind, slug)

const livePlayMapTokenCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: MapTokenActionDependencies) => ({
  readSheet: dependencies.readSheet ?? readDefaultSheet,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
  maxMovementLogEntries: dependencies.maxMovementLogEntries,
  commandExecutor: dependencies.commandExecutor ?? livePlayMapTokenCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
})

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

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

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
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const clonePosition = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

interface AppliedMapTokenChange {
  readonly nextMap: TabletopMap
  readonly placement: SheetPlacement
  readonly timestamp?: number
}

const applyMoveTokenToMap = (
  input: Pick<MoveMapTokenInput, 'position' | 'pathLength'>,
  context: ResolvedMapTokenActionContext,
  dependencies: Required<Pick<MapTokenActionDependencies, 'readSheet' | 'now'>> & Pick<MapTokenActionDependencies, 'maxMovementLogEntries'>,
): AppliedMapTokenChange | null => {
  const nextPosition = clampAnchorToDimensions(input.position, context.placement.position, context.map.dimensions)
  const currentPosition = context.placement.position
  const moving = !sameGridAnchor(currentPosition, nextPosition)
  const nextFacing = moving
    ? tokenFacingTowardPoint(currentPosition, nextPosition, tokenFacingForPlacement(context.placement))
    : null

  if (!moving && nextFacing === null) return null

  const nextPlacement: SheetPlacement = {
    ...context.placement,
    position: nextPosition,
    ...(nextFacing === null
      ? {}
      : {
          facing: nextFacing,
          turned: tokenFacingStoresLegacyTurned(nextFacing),
        }),
  }
  const placements = context.map.placements.map((placement) => (
    placement.id === context.placement.id ? nextPlacement : placement
  ))
  const timestamp = dependencies.now()
  const metadata = moving
    ? appendMovementLogEntry(context.map.metadata, {
        userId: context.placement.id,
        userName: sheetDisplayName(context.placement, dependencies.readSheet),
        from: currentPosition,
        to: nextPosition,
        pathLength: normalizedPathLength(input.pathLength),
      }, {
        now: () => timestamp,
        maxLogEntries: dependencies.maxMovementLogEntries,
      })
    : context.map.metadata

  return {
    nextMap: {
      ...context.map,
      placements,
      metadata,
      updatedAt: timestamp,
    },
    placement: nextPlacement,
    timestamp,
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

const normalizeLivePlaySpawnPlacement = (placement: SheetPlacement): SheetPlacement => {
  const facing = tokenFacingForPlacement(placement)
  return {
    id: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    position: clonePosition(placement.position),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    ...(placement.initiative === undefined ? {} : { initiative: placement.initiative }),
  }
}

const applySpawnTokenToMap = (
  payload: SpawnTokenPayload,
  context: ResolvedMapWriteContext,
): AppliedMapTokenChange => {
  const placement = normalizeLivePlaySpawnPlacement(payload.placement)
  if (!isPositionWithinMapBounds(placement.position, context.map)) {
    rejectLivePlayCommand('invalid', `spawnToken placement ${placement.id} position is outside map bounds`)
  }
  if (context.map.placements.some((candidate) => candidate.id === placement.id)) {
    rejectLivePlayCommand('conflict', `Placement ${placement.id} already exists`, {
      currentRevision: normalizeRevision(context.map.revision),
      currentState: context.map.placements.find((candidate) => candidate.id === placement.id),
    })
  }

  return {
    nextMap: {
      ...context.map,
      placements: [...context.map.placements, placement],
    },
    placement,
  }
}

interface ResolvedSendOutPokemonMapContext {
  readonly trainerPlacement: SheetPlacement
  readonly placement: SheetPlacement
  readonly trainerToken: SpawnedPokemon
  readonly pokemonToken: SpawnedPokemon
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

const normalizeLivePlaySendOutPlacement = (payload: SendOutPokemonPayload): SheetPlacement => {
  const facing = payload.facing ?? DEFAULT_TOKEN_FACING_DIRECTION
  return {
    id: payload.tokenId,
    sheetKind: 'pokemon',
    sheetSlug: payload.pokemonSlug,
    position: clonePosition(payload.position),
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
  const existingPlacement = context.map.placements.find((candidate) => candidate.id === payload.tokenId)
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
  if (!trainerOwnsCurrentTeamPokemon(trainerRecord.sheet, payload.pokemonSlug)) {
    rejectLivePlayCommand('conflict', `Trainer ${trainerPlacement.sheetSlug} does not have Pokémon ${payload.pokemonSlug} on their current team`)
  }

  const placement = normalizeLivePlaySendOutPlacement(payload)
  const lookup = sendOutSheetLookup(trainerPlacement, trainerRecord.sheet, payload.pokemonSlug, pokemonRecord.sheet)
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
    range: POKEBALL_THROW_RANGE_SQUARES,
  })) {
    rejectLivePlayCommand(
      'conflict',
      `Pokémon ${payload.pokemonSlug} cannot be sent out at ${placement.position.x},${placement.position.y},${placement.position.z}; the destination is outside the trainer's Poké Ball throw range`,
    )
  }

  return {
    trainerPlacement,
    placement,
    trainerToken,
    pokemonToken,
  }
}

const applySendOutPokemonToMap = (
  payload: SendOutPokemonPayload,
  context: ResolvedMapWriteContext,
  dependencies: Pick<MapTokenActionDependencySet, 'readSheet'>,
): AppliedMapTokenChange => {
  const resolved = resolveSendOutPokemonMapContext(payload, context, dependencies)
  return {
    nextMap: {
      ...context.map,
      placements: [...context.map.placements, resolved.placement],
    },
    placement: resolved.placement,
  }
}

const applyDeleteTokenToMap = (
  payload: DeleteTokenPayload,
  context: ResolvedMapWriteContext,
): AppliedMapTokenChange => {
  const placement = context.map.placements.find((candidate) => candidate.id === payload.placementId)
  if (!placement) throw new MapTokenActionUseCaseError(404, `Placement ${payload.placementId} not found`)

  const nextInitiative = context.map.initiative?.activeId === payload.placementId
    ? { ...context.map.initiative, activeId: null }
    : context.map.initiative

  return {
    nextMap: {
      ...context.map,
      placements: context.map.placements.filter((candidate) => candidate.id !== payload.placementId),
      ...(nextInitiative === undefined ? {} : { initiative: nextInitiative }),
    },
    placement,
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
  if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y) || !isFiniteCoordinate(z)) {
    rejectLivePlayCommand('invalid', 'moveToken payload.position coordinates must be finite numbers')
  }
  if (
    pathLength !== undefined
    && pathLength !== null
    && (typeof pathLength !== 'number' || !Number.isFinite(pathLength) || pathLength < 0)
  ) {
    rejectLivePlayCommand('invalid', 'moveToken payload.pathLength must be a non-negative finite number')
  }

  return {
    placementId: placementId as string,
    position: {
      x: x as number,
      y: y as number,
      z: z as number,
    },
    ...(pathLength === undefined ? {} : { pathLength: pathLength as number | null }),
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
    },
  }
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

export const executeMapTokenLivePlayCommandUseCase = async (
  input: ExecuteMapTokenLivePlayCommandInput,
  dependencies: MapTokenActionDependencies = {},
): Promise<MapTokenLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedMapTokenCommandResponseContext | null = null

  const result = await deps.commandExecutor.execute<MapTokenLivePlayCommand, ResolvedMapWriteContext, MapTokenLivePlayActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command }) => resolveLivePlayMapWriteContext({ role: input.role, slug: command.mapSlug }, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
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
    apply: ({ command, map, currentRevision }) => {
      const placementId = commandPlacementId(command)
      const existingPlacement = map.map.placements.find((candidate) => candidate.id === placementId)
      const context = existingPlacement ? { ...map, placement: existingPlacement } : null
      const change = command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
        ? (context ? applyMoveTokenToMap(command.payload, context, deps) : null)
        : command.type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
          ? (context ? applyTurnTokenToMap(command.payload, context) : null)
          : command.type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
            ? applySpawnTokenToMap(expectSpawnTokenPayload(command.payload), map)
            : command.type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
              ? applySendOutPokemonToMap(expectSendOutPokemonPayload(command.payload), map, deps)
              : applyDeleteTokenToMap(expectDeleteTokenPayload(command.payload), map)

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
        patches: [commandPatch(command, revision, change)],
      }
    },
    persist: async ({ actor, command, currentRevision, nextMap, result }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.mapPath, deps.now(), { revision: result.revision })
      const updateResult = await deps.mapRepository.applyLivePlayUpdate({
        slug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
      })
      if (updateResult === 'stale') {
        throw new MapTokenActionUseCaseError(409, `Map ${result.mapSlug} changed before the live-play command could be persisted`)
      }
      const storedMap = await deps.mapRepository.getBySlug(result.mapSlug)
      const authoritativeMap = storedMap ?? persisted
      const placementId = placementIdFromAcceptedResult(result)
      const placement = placementId
        ? authoritativeMap.placements.find((candidate) => candidate.id === placementId) ?? placementFromPlacementPatch(result)
        : placementFromPlacementPatch(result)
      if (!placement && command.type !== LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN) {
        throw new MapTokenActionUseCaseError(404, 'Token command applied but persisted placement was not found')
      }
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: authoritativeMap,
        ...(placement === undefined ? {} : { placement }),
      }
      void actor
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return persistedCommandResponse(result, responseContext)
}
