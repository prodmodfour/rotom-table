import { UseCaseHttpError } from '../utils/useCaseErrors'
import { join } from 'node:path'
import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { GridDimensions, TabletopMap } from '~/types/map'
import { allocateSlug, writeMapFile } from '../utils/mapStorage'
import { MAPS_ROOT, ensureMapsRoot, sanitizeMapFolderPath } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'

export class CreateMapUseCaseError extends UseCaseHttpError<400> {}

export interface CreateMapInput {
  name?: unknown
  folder?: unknown
  dimensions?: unknown
  clientId?: string
}

export interface CreateMapDependencies {
  mapsRoot?: string
  now?: () => number
  ensureRoot?: () => void
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  allocateMapSlug?: (name: string) => string
  writeMap?: (filePath: string, map: TabletopMap) => void
}

export interface CreateMapResult {
  map: TabletopMap
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
  const ensureRoot = dependencies.ensureRoot ?? ensureMapsRoot
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const allocateMapSlug = dependencies.allocateMapSlug ?? allocateSlug
  const writeMap = dependencies.writeMap ?? writeMapFile
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const now = dependencies.now ?? Date.now

  const name = normalizeCreateMapName(input.name)
  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  const dimensions = normalizeCreateMapDimensions(input.dimensions)

  ensureRoot()
  const slug = allocateMapSlug(name)
  const timestamp = now()
  const map: TabletopMap = {
    schemaVersion: 2,
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

  const filePath = folder
    ? join(mapsRoot, folder, `${slug}.json`)
    : join(mapsRoot, `${slug}.json`)
  writeMap(filePath, map)

  return {
    map,
    events: [
      {
        channel: mapsChannel,
        type: 'created',
        clientId: input.clientId,
        data: summarizeMap(map),
      },
    ],
  }
}
