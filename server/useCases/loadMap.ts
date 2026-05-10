import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '~/shared/auth'
import type { TabletopMap } from '~/types/map'
import { SLUG_RE, findMapFile, readMapFile } from '../utils/mapStorage'

export class LoadMapUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface LoadMapInput {
  slug?: unknown
  role: AuthRole
}

export interface LoadMapDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (filePath: string) => TabletopMap
}

export interface LoadMapResult {
  map: TabletopMap
}

const SLUG_ERROR = 'slug must match /^[a-z0-9-]+$/'

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

  const slug = normalizeLoadMapSlug(input.slug)
  const path = findMapPath(slug)
  if (!path) throw new LoadMapUseCaseError(404, `Map ${slug}.json not found`)

  const map = (() => {
    try {
      return readMap(path)
    } catch (err) {
      throw new LoadMapUseCaseError(
        400,
        (err as Error).message || `Map ${slug}.json is invalid`,
      )
    }
  })()

  if (input.role === 'player' && map.playerVisible !== true) {
    throw new LoadMapUseCaseError(403, 'Map is not player visible')
  }

  return { map }
}
