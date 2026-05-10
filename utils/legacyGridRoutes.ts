import { routeParamAsString } from '~/utils/routeParams'

export const legacyGridIndexRedirectPath = (): string => '/maps'

export const legacyGridDetailRedirectPath = (slugParam: unknown): string =>
  `/maps/${routeParamAsString(slugParam)}`
