import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { GridDimensions, TabletopMap } from '~/types/map'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class CreateMapUseCaseError extends UseCaseHttpError<400 | 409> {}

export interface CreateMapInput {
  name?: unknown
  folder?: unknown
  dimensions?: unknown
  clientId?: string
}

export interface CreateMapDependencies {
  now?: () => number
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  mapRepository?: Pick<MapRepository, 'allocateSlug' | 'create'>
}

export interface CreateMapResult {
  map: TabletopMap
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const DEFAULT_MAP_DIMENSIONS: GridDimensions = { x: 20, y: 12, z: 20 }

const MAX_MAP_NAME_LENGTH = 80

const clampMapDimension = (value: unknown, fallback: number): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(200, Math.max(1, Math.round(n)))
}

export const normalizeCreateMapName = (value: unknown): string => {
  const name = String(value ?? '').trim() || 'Untitled Map'
  if (name.length > MAX_MAP_NAME_LENGTH) {
    throw new CreateMapUseCaseError(400, 'name too long (max 80 chars)')
  }
  return name
}

export const normalizeCreateMapDimensions = (value: unknown): GridDimensions => {
  const source = value ?? DEFAULT_MAP_DIMENSIONS
  const dimensions = source as Partial<Record<keyof GridDimensions, unknown>>
  return {
    x: clampMapDimension(dimensions.x, DEFAULT_MAP_DIMENSIONS.x),
    y: clampMapDimension(dimensions.y, DEFAULT_MAP_DIMENSIONS.y),
    z: clampMapDimension(dimensions.z, DEFAULT_MAP_DIMENSIONS.z),
  }
}

const normalizeCreateMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), true)
  } catch (err) {
    throw new CreateMapUseCaseError(400, (err as Error).message)
  }
}

export const createMapUseCase = (
  input: CreateMapInput,
  dependencies: CreateMapDependencies = {},
): CreateMapResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const now = dependencies.now ?? Date.now

  const name = normalizeCreateMapName(input.name)
  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  const dimensions = normalizeCreateMapDimensions(input.dimensions)
  const slug = mapRepository.allocateSlug(name)
  const timestamp = now()
  const map: TabletopMap = {
    schemaVersion: 2,
    revision: 0,
    slug,
    name,
    folder,
    dimensions,
    groundLevelY: 0,
    playerVisible: false,
    placements: [],
    initiative: { activeId: null, round: 1 },
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    lights: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  let created: TabletopMap
  try {
    created = mapRepository.create({ slug, map, now: timestamp })
  } catch (err) {
    throw new CreateMapUseCaseError(409, (err as Error).message)
  }

  return {
    map: created,
    path: logicalMapResourcePath(created),
    events: [
      {
        channel: mapsChannel,
        type: 'created',
        revision: created.revision,
        clientId: input.clientId,
        data: summarizeMap(created),
      },
    ],
  }
}
