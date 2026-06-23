import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { validateSlug } from '#shared/paths'
import {
  sqliteMapRepository,
  type MapRepository,
  type StoredMapDocument,
} from '../storage/mapRepository'
import { normalizeMapDocument } from '../utils/mapNormalization'

export class LoadMapUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface LoadMapInput {
  slug?: unknown
  role: AuthRole
}

export interface LoadMapDependencies {
  mapRepository?: Pick<MapRepository, 'getBySlug'> | Pick<MapRepository, 'get'>
}

export interface LoadMapResult {
  map: TabletopMap
  revision: number
}

export const normalizeLoadMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new LoadMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const loadMapUseCase = (
  input: LoadMapInput,
  dependencies: LoadMapDependencies = {},
): LoadMapResult => {
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const slug = normalizeLoadMapSlug(input.slug)

  let map: TabletopMap | null
  try {
    if ('getBySlug' in mapRepository && typeof mapRepository.getBySlug === 'function') {
      map = mapRepository.getBySlug(slug)
    } else {
      const stored = (mapRepository as Pick<MapRepository, 'get'>).get(slug) as StoredMapDocument | null
      map = stored
        ? {
            ...normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` }),
            slug: stored.slug,
            revision: stored.revision,
            updatedAt: stored.updatedAt,
          }
        : null
    }
  } catch (err) {
    throw new LoadMapUseCaseError(
      400,
      (err as Error).message || `Map ${slug} is invalid in SQLite`,
    )
  }

  if (!map) throw new LoadMapUseCaseError(404, `Map ${slug}.json not found`)

  if (input.role === 'player' && map.playerVisible !== true) {
    throw new LoadMapUseCaseError(403, 'Map is not player visible')
  }

  return { map, revision: normalizeRevision(map.revision) }
}
