import { MAP_LIBRARY_PATH, mapLibraryPath } from '~/utils/mapRoutes'
import { routeParamAsString } from '~/utils/routeParams'

export const LEGACY_GRID_PATH = '/grids'

export const isLegacyGridPath = (path: string): boolean =>
  path === LEGACY_GRID_PATH || path.startsWith(`${LEGACY_GRID_PATH}/`)

export const legacyGridIndexRedirectPath = (): string => mapLibraryPath()

export const legacyGridDetailRedirectPath = (slugParam: unknown): string =>
  `${MAP_LIBRARY_PATH}/${routeParamAsString(slugParam)}`
