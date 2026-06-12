import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayTokenScope,
  type MoveTokenLivePlayCommand,
  type MoveTokenPayload,
  type TurnTokenLivePlayCommand,
  type TurnTokenPayload,
} from '#shared/livePlayCommands'
import type { RealtimeEvent } from '#shared/realtime'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { appendMovementLogEntry, sameGridAnchor } from '~/utils/mapMovementLog'
import { sameJsonValue } from '~/utils/serialization'
import {
  isTokenFacingDirection,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { readSheetFile } from '../utils/sheetStorage'
import {
  livePlayCommandAcceptedRealtimeEvent,
  mapDocumentUpdatedRealtimeEvents,
} from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { canSaveMap, clampAnchorToDimensions } from '../policies/mapPolicy'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import {
  executeAuthoritativeLivePlayCommand,
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { toPersistedMap } from './saveMap'

export class MapTokenActionUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface SpawnMapTokenInput {
  role: AuthRole
  slug: string
  placement: SheetPlacement
  clientId?: string
}

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

export type MapTokenLivePlayCommand = MoveTokenLivePlayCommand | TurnTokenLivePlayCommand

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
  expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
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
  findMapPath?: (slug: string) => string | null
  readMap?: (path: string) => TabletopMap
  writeMap?: (path: string, map: TabletopMap) => void
  readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  now?: () => number
  relativePath?: (path: string) => string
  maxMovementLogEntries?: number
  commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
}

export interface MapTokenActionResult {
  ok: true
  path: string
  map: TabletopMap
  placement: SheetPlacement
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface ResolvedMapWriteContext {
  mapPath: string
  relativePath: string
  map: TabletopMap
}

interface ResolvedMapTokenActionContext extends ResolvedMapWriteContext {
  placement: SheetPlacement
}

const mapEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => mapDocumentUpdatedRealtimeEvents(map, clientId)

const noChangeResult = (
  context: ResolvedMapTokenActionContext,
): MapTokenActionResult => ({
  ok: true,
  path: context.relativePath,
  map: context.map,
  placement: context.placement,
  events: [],
})

const resolveMapWriteContext = (
  input: Pick<MoveMapTokenInput, 'role' | 'slug'>,
  dependencies: Required<Pick<MapTokenActionDependencies, 'findMapPath' | 'readMap' | 'relativePath'>>,
): ResolvedMapWriteContext => {
  const mapPath = dependencies.findMapPath(input.slug)
  if (!mapPath) throw new MapTokenActionUseCaseError(404, `Map ${input.slug}.json not found`)

  const map = dependencies.readMap(mapPath)
  if (!canSaveMap(input.role, map)) {
    throw new MapTokenActionUseCaseError(403, 'Map is not player visible')
  }

  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const resolveContext = (
  input: Pick<MoveMapTokenInput, 'role' | 'slug' | 'placementId' | 'playerProfile'>,
  dependencies: Required<Pick<MapTokenActionDependencies, 'findMapPath' | 'readMap' | 'relativePath'>>,
): ResolvedMapTokenActionContext => {
  const context = resolveMapWriteContext(input, dependencies)
  const placement = context.map.placements.find((candidate) => candidate.id === input.placementId)
  if (!placement) {
    throw new MapTokenActionUseCaseError(404, `Placement ${input.placementId} not found`)
  }

  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement,
  })) {
    const message = input.role === 'player' && !input.playerProfile
      ? 'Select a player profile to control linked map tokens'
      : 'Token is not linked to selected player profile'
    throw new MapTokenActionUseCaseError(403, message)
  }

  return {
    ...context,
    placement,
  }
}

const writeActionMap = (
  input: Pick<MoveMapTokenInput, 'clientId'>,
  context: ResolvedMapTokenActionContext,
  nextMap: TabletopMap,
  dependencies: Required<Pick<MapTokenActionDependencies, 'writeMap' | 'now'>>,
): MapTokenActionResult => {
  const persisted = toPersistedMap(nextMap, context.mapPath, dependencies.now(), { advanceRevision: true })
  dependencies.writeMap(context.mapPath, persisted)
  const placement = persisted.placements.find((candidate) => candidate.id === context.placement.id)
    ?? context.placement

  return {
    ok: true,
    path: context.relativePath,
    map: persisted,
    placement,
    events: mapEvents(persisted, input.clientId),
  }
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

const actionDependencies = (dependencies: MapTokenActionDependencies) => ({
  findMapPath: dependencies.findMapPath ?? findMapFile,
  readMap: dependencies.readMap ?? readMapFile,
  writeMap: dependencies.writeMap ?? writeMapFile,
  readSheet: dependencies.readSheet ?? readDefaultSheet,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
  maxMovementLogEntries: dependencies.maxMovementLogEntries,
  commandExecutor: dependencies.commandExecutor ?? { execute: executeAuthoritativeLivePlayCommand },
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
})

const clonePosition = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const normalizeSpawnPlacement = (
  placement: SheetPlacement,
  map: TabletopMap,
): SheetPlacement => {
  const position = clampAnchorToDimensions(placement.position, placement.position, map.dimensions)
  const facing = tokenFacingForPlacement(placement)
  return {
    id: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    position: clonePosition(position),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    ...(placement.initiative === undefined ? {} : { initiative: placement.initiative }),
  }
}

const duplicateSpawnResult = (
  context: ResolvedMapWriteContext,
  placement: SheetPlacement,
): MapTokenActionResult => ({
  ok: true,
  path: context.relativePath,
  map: context.map,
  placement,
  events: [],
})

export const spawnMapTokenUseCase = (
  input: SpawnMapTokenInput,
  dependencies: MapTokenActionDependencies = {},
): MapTokenActionResult => {
  if (input.role !== 'gm') {
    throw new MapTokenActionUseCaseError(403, 'Only GMs can spawn map tokens')
  }

  const deps = actionDependencies(dependencies)
  const context = resolveMapWriteContext(input, deps)
  const nextPlacement = normalizeSpawnPlacement(input.placement, context.map)
  const existingPlacement = context.map.placements.find((placement) => placement.id === nextPlacement.id)

  if (existingPlacement) {
    if (sameJsonValue(existingPlacement, nextPlacement)) {
      return duplicateSpawnResult(context, existingPlacement)
    }
    throw new MapTokenActionUseCaseError(409, `Placement ${nextPlacement.id} already exists`)
  }

  return writeActionMap(input, {
    ...context,
    placement: nextPlacement,
  }, {
    ...context.map,
    placements: [...context.map.placements, nextPlacement],
  }, deps)
}

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

export const moveMapTokenUseCase = (
  input: MoveMapTokenInput,
  dependencies: MapTokenActionDependencies = {},
): MapTokenActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveContext(input, deps)
  const change = applyMoveTokenToMap(input, context, deps)
  if (!change) return noChangeResult(context)

  return writeActionMap(input, context, change.nextMap, {
    ...deps,
    now: () => change.timestamp ?? deps.now(),
  })
}

export const turnMapTokenUseCase = (
  input: TurnMapTokenInput,
  dependencies: MapTokenActionDependencies = {},
): MapTokenActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveContext(input, deps)
  const change = applyTurnTokenToMap(input, context)
  if (!change) return noChangeResult(context)

  return writeActionMap(input, context, change.nextMap, deps)
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

const tokenScopeMatches = (
  scopes: readonly LivePlayTokenScope[],
  placementId: string,
  field: LivePlayTokenScope['field'],
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === field
))

const expectCommandPayloadAndScope = (command: MapTokenLivePlayCommand): MoveTokenPayload | TurnTokenPayload => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN) {
    const payload = expectMoveTokenPayload(command.payload)
    if (!tokenScopeMatches(command.scopes, payload.placementId, 'position')) {
      rejectLivePlayCommand('invalid', 'moveToken scopes must include the token position scope for payload.placementId')
    }
    return payload
  }

  const payload = expectTurnTokenPayload(command.payload)
  if (!tokenScopeMatches(command.scopes, payload.placementId, 'facing')) {
    rejectLivePlayCommand('invalid', 'turnToken scopes must include the token facing scope for payload.placementId')
  }
  return payload
}

const commandPlacementId = (command: MapTokenLivePlayCommand): string => {
  const payload = expectCommandPayloadAndScope(command)
  return payload.placementId
}

const commandPatch = (
  command: MapTokenLivePlayCommand,
  revision: number,
  placement: SheetPlacement,
): LivePlayPatch => ({
  schemaVersion: command.schemaVersion,
  type: command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
    ? LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION
    : LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
    ? {
        placementId: placement.id,
        position: placement.position,
        ...(placement.facing === undefined ? {} : { facing: placement.facing }),
        ...(placement.turned === undefined ? {} : { turned: placement.turned }),
      }
    : {
        placementId: placement.id,
        facing: placement.facing,
        turned: placement.turned,
      },
})

const persistedCommandResponse = (
  result: LivePlayCommandResult,
  context: ResolvedMapTokenActionContext | null,
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

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId ?? null
)

const currentContextForAcceptedResult = (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: ReturnType<typeof actionDependencies>,
): ResolvedMapTokenActionContext | null => {
  const placementId = placementIdFromAcceptedResult(result)
  if (!placementId) return null

  try {
    const context = resolveMapWriteContext({ role, slug: result.mapSlug }, dependencies)
    const placement = context.map.placements.find((candidate) => candidate.id === placementId)
    return placement ? { ...context, placement } : null
  } catch {
    return null
  }
}

export const executeMapTokenLivePlayCommandUseCase = async (
  input: ExecuteMapTokenLivePlayCommandInput,
  dependencies: MapTokenActionDependencies = {},
): Promise<MapTokenLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedMapTokenActionContext | null = null

  const result = await deps.commandExecutor.execute<MapTokenLivePlayCommand, ResolvedMapWriteContext, MapTokenLivePlayActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command }) => resolveMapWriteContext({ role: input.role, slug: command.mapSlug }, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      if (input.expectedType && command.type !== input.expectedType) {
        rejectLivePlayCommand('invalid', `This route only accepts ${input.expectedType} commands`)
      }
      if (
        command.type !== LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
        && command.type !== LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN
      ) {
        rejectLivePlayCommand('invalid', 'Map token live-play routes support moveToken and turnToken commands only')
      }

      const placementId = commandPlacementId(command)
      const placement = map.map.placements.find((candidate) => candidate.id === placementId)
      if (!placement) throw new MapTokenActionUseCaseError(404, `Placement ${placementId} not found`)
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement,
      })) {
        const message = actor.role === 'player' && !actor.playerProfile
          ? 'Select a player profile to control linked map tokens'
          : 'Token is not linked to selected player profile'
        throw new MapTokenActionUseCaseError(403, message)
      }
    },
    apply: ({ command, actor, map, currentRevision }) => {
      const placementId = commandPlacementId(command)
      const placement = map.map.placements.find((candidate) => candidate.id === placementId)
      if (!placement) throw new MapTokenActionUseCaseError(404, `Placement ${placementId} not found`)
      const context: ResolvedMapTokenActionContext = { ...map, placement }
      const change = command.type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
        ? applyMoveTokenToMap(command.payload, context, deps)
        : applyTurnTokenToMap(command.payload, context)

      if (!change) {
        return {
          status: 'rejected',
          reason: 'no-op',
          message: `${command.type} did not change token ${placementId}`,
          currentRevision,
          currentState: placement,
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
        patches: [commandPatch(command, revision, change.placement)],
      }
    },
    persist: ({ actor, nextMap, result }) => {
      const updatedAt = nextMap.map.updatedAt ?? deps.now()
      const persisted = toPersistedMap(nextMap.map, nextMap.mapPath, updatedAt, { revision: result.revision })
      deps.writeMap(nextMap.mapPath, persisted)
      const placementId = result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId
      const placement = placementId
        ? persisted.placements.find((candidate) => candidate.id === placementId)
        : undefined
      if (!placement) throw new MapTokenActionUseCaseError(404, 'Token command applied but persisted placement was not found')
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: persisted,
        placement,
      }
      void actor
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      for (const event of mapEvents(persistedContext.map, actor.clientId)) {
        deps.publishRealtimeEvent(event)
      }
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? currentContextForAcceptedResult(result, input.role, deps) : null)
  return persistedCommandResponse(result, responseContext)
}
