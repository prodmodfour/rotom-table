import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { findMapFile, readMapFile } from '../utils/mapStorage'
import { normalizeMapDocument } from '../utils/mapNormalization'
import { SLUG_RE } from '../utils/mapPaths'
import {
  sqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import {
  sqliteMapRepository,
  type MapRepository,
  type StoredMapDocument,
} from '../storage/mapRepository'

export class LoadMapUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface LoadMapInput {
  slug?: unknown
  role: AuthRole
}

export interface LoadMapDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (filePath: string) => TabletopMap
  modeRepository?: Pick<MapInteractionModeRepository, 'get'>
  mapRepository?: Pick<MapRepository, 'get'>
}

export interface LoadMapResult {
  map: TabletopMap
  revision: number
}

const SLUG_ERROR = 'slug must match /^[a-z0-9-]+$/'

const storedMapDocumentToTabletopMap = (stored: StoredMapDocument): TabletopMap => {
  const map = normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` })
  if (map.slug !== stored.slug) {
    throw new Error(`SQLite map ${stored.slug} document slug must match the row slug`)
  }
  return {
    ...map,
    revision: normalizeRevision(stored.revision),
    updatedAt: stored.updatedAt,
  }
}

export const normalizeLoadMapSlug = (value: unknown): string => {
  const slug = String(value ?? '')
  if (!SLUG_RE.test(slug)) throw new LoadMapUseCaseError(400, SLUG_ERROR)
  return slug
}

export const loadMapUseCase = (
  input: LoadMapInput,
  dependencies: LoadMapDependencies = {},
): LoadMapResult => {
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile
  const modeRepository = dependencies.modeRepository ?? sqliteMapInteractionModeRepository
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository

  const slug = normalizeLoadMapSlug(input.slug)

  const readFileBackedMap = (): TabletopMap => {
    const path = findMapPath(slug)
    if (!path) throw new LoadMapUseCaseError(404, `Map ${slug}.json not found`)

    try {
      return readMap(path)
    } catch (err) {
      throw new LoadMapUseCaseError(
        400,
        (err as Error).message || `Map ${slug}.json is invalid`,
      )
    }
  }

  const readLivePlayMap = (): TabletopMap | null => {
    const stored = mapRepository.get(slug)
    if (!stored) return null
    try {
      return storedMapDocumentToTabletopMap(stored as StoredMapDocument)
    } catch (err) {
      throw new LoadMapUseCaseError(
        400,
        (err as Error).message || `Map ${slug} is invalid in the live-play repository`,
      )
    }
  }

  const mode = modeRepository.get(slug).interactionMode
  const map = mode === MAP_INTERACTION_MODES.LIVE_PLAY
    ? readLivePlayMap() ?? readFileBackedMap()
    : readFileBackedMap()

  if (input.role === 'player' && map.playerVisible !== true) {
    throw new LoadMapUseCaseError(403, 'Map is not player visible')
  }

  return { map, revision: normalizeRevision(map.revision) }
}
