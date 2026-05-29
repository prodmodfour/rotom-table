import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GridAnchor, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { appendMovementLogEntry, sameGridAnchor } from '~/utils/mapMovementLog'
import {
  isTokenFacingDirection,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { readSheetFile } from '../utils/sheetStorage'
import { summarizeMap } from '../utils/mapSummaries'
import { canSaveMap, clampAnchorToDimensions } from '../policies/mapPolicy'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import { toPersistedMap } from './saveMap'

export class MapTokenActionUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

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
}

export interface MapTokenActionResult {
  ok: true
  path: string
  map: TabletopMap
  placement: SheetPlacement
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface ResolvedMapTokenActionContext {
  mapPath: string
  relativePath: string
  map: TabletopMap
  placement: SheetPlacement
}

const mapEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => [
  {
    channel: mapChannel(map.slug),
    type: 'updated',
    clientId,
    data: map,
  },
  {
    channel: mapsChannel,
    type: 'updated',
    clientId,
    data: summarizeMap(map),
  },
]

const noChangeResult = (
  context: ResolvedMapTokenActionContext,
): MapTokenActionResult => ({
  ok: true,
  path: context.relativePath,
  map: context.map,
  placement: context.placement,
  events: [],
})

const resolveContext = (
  input: Pick<MoveMapTokenInput, 'role' | 'slug' | 'placementId' | 'playerProfile'>,
  dependencies: Required<Pick<MapTokenActionDependencies, 'findMapPath' | 'readMap' | 'relativePath'>>,
): ResolvedMapTokenActionContext => {
  const mapPath = dependencies.findMapPath(input.slug)
  if (!mapPath) throw new MapTokenActionUseCaseError(404, `Map ${input.slug}.json not found`)

  const map = dependencies.readMap(mapPath)
  if (!canSaveMap(input.role, map)) {
    throw new MapTokenActionUseCaseError(403, 'Map is not player visible')
  }

  const placement = map.placements.find((candidate) => candidate.id === input.placementId)
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
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    placement,
  }
}

const writeActionMap = (
  input: Pick<MoveMapTokenInput, 'clientId'>,
  context: ResolvedMapTokenActionContext,
  nextMap: TabletopMap,
  dependencies: Required<Pick<MapTokenActionDependencies, 'writeMap' | 'now'>>,
): MapTokenActionResult => {
  const persisted = toPersistedMap(nextMap, context.mapPath, dependencies.now())
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
})

export const moveMapTokenUseCase = (
  input: MoveMapTokenInput,
  dependencies: MapTokenActionDependencies = {},
): MapTokenActionResult => {
  const deps = actionDependencies(dependencies)
  const context = resolveContext(input, deps)
  const nextPosition = clampAnchorToDimensions(input.position, context.placement.position, context.map.dimensions)
  const currentPosition = context.placement.position
  const moving = !sameGridAnchor(currentPosition, nextPosition)
  const nextFacing = moving
    ? tokenFacingTowardPoint(currentPosition, nextPosition, tokenFacingForPlacement(context.placement))
    : null

  if (!moving && nextFacing === null) return noChangeResult(context)

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
  const timestamp = deps.now()
  const metadata = moving
    ? appendMovementLogEntry(context.map.metadata, {
        userId: context.placement.id,
        userName: sheetDisplayName(context.placement, deps.readSheet),
        from: currentPosition,
        to: nextPosition,
        pathLength: normalizedPathLength(input.pathLength),
      }, {
        now: () => timestamp,
        maxLogEntries: deps.maxMovementLogEntries,
      })
    : context.map.metadata

  return writeActionMap(input, context, {
    ...context.map,
    placements,
    metadata,
  }, {
    ...deps,
    now: () => timestamp,
  })
}

export const turnMapTokenUseCase = (
  input: TurnMapTokenInput,
  dependencies: MapTokenActionDependencies = {},
): MapTokenActionResult => {
  if (!isTokenFacingDirection(input.facing)) {
    throw new MapTokenActionUseCaseError(400, 'facing must be a token facing direction')
  }

  const deps = actionDependencies(dependencies)
  const context = resolveContext(input, deps)
  const turned = tokenFacingStoresLegacyTurned(input.facing)
  if (context.placement.facing === input.facing && context.placement.turned === turned) {
    return noChangeResult(context)
  }

  const nextPlacement: SheetPlacement = {
    ...context.placement,
    facing: input.facing,
    turned,
  }
  const placements = context.map.placements.map((placement) => (
    placement.id === context.placement.id ? nextPlacement : placement
  ))

  return writeActionMap(input, context, {
    ...context.map,
    placements,
  }, deps)
}
