import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'
import { validateSlug } from '#shared/paths'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'
import { mapRevisionForRealtime, mapUpdatedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class MoveMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapInput {
  slug?: unknown
  folder?: unknown
  clientId?: string
}

export interface MoveMapDependencies {
  now?: () => number
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  mapRepository?: Pick<MapRepository, 'moveToFolder'>
}

export interface MoveMapResult {
  ok: true
  moved: boolean
  path: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const normalizeMoveMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new MoveMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const normalizeMoveMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), true)
  } catch (err) {
    throw new MoveMapUseCaseError(400, (err as Error).message)
  }
}

export const moveMapUseCase = (
  input: MoveMapInput,
  dependencies: MoveMapDependencies = {},
): MoveMapResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const now = dependencies.now ?? Date.now

  const slug = normalizeMoveMapSlug(input.slug)
  const folder = normalizeMoveMapFolder(input.folder, sanitizeFolder)

  let result
  try {
    result = mapRepository.moveToFolder({ slug, folder, now: now() })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already exists')) throw new MoveMapUseCaseError(409, message)
    throw new MoveMapUseCaseError(400, message)
  }
  if (!result) throw new MoveMapUseCaseError(404, `Map ${slug}.json not found`)

  return {
    ok: true,
    moved: result.moved,
    path: logicalMapResourcePath(result.map),
    map: result.map,
    events: result.moved
      ? [
          mapUpdatedRealtimeEvent(result.map, input.clientId),
          {
            channel: mapsChannel,
            type: 'moved',
            revision: mapRevisionForRealtime(result.map),
            clientId: input.clientId,
            data: summarizeMap(result.map),
          },
        ]
      : [],
  }
}
