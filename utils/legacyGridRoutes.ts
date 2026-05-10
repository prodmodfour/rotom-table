import { mapLibraryPath } from '~/utils/mapRoutes'
import { routeParamAsString } from '~/utils/routeParams'

export const legacyGridIndexRedirectPath = (): string => mapLibraryPath()

export const legacyGridDetailRedirectPath = (slugParam: unknown): string =>
  `/maps/${routeParamAsString(slugParam)}`
