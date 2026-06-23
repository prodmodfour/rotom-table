import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { AuthRole } from '#shared/auth'
import type { MapInteractionMode } from '#shared/mapInteractionMode'
import { loadMapUseCase, type LoadMapDependencies } from './loadMap'
import {
  sqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'

export class GetMapInteractionModeUseCaseError extends UseCaseHttpError<400 | 403 | 404> {}

export interface GetMapInteractionModeInput {
  readonly role: AuthRole
  readonly slug?: unknown
}

export interface GetMapInteractionModeDependencies extends LoadMapDependencies {
  readonly modeRepository?: Pick<MapInteractionModeRepository, 'get'>
}

export interface GetMapInteractionModeResult {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export const getMapInteractionModeUseCase = (
  input: GetMapInteractionModeInput,
  dependencies: GetMapInteractionModeDependencies = {},
): GetMapInteractionModeResult => {
  const { modeRepository = sqliteMapInteractionModeRepository, ...loadDependencies } = dependencies
  try {
    const { map } = loadMapUseCase({ role: input.role, slug: input.slug }, loadDependencies)
    const state = modeRepository.get(map.slug)
    return {
      slug: map.slug,
      interactionMode: state.interactionMode,
      updatedAt: state.updatedAt,
    }
  } catch (error) {
    if (error instanceof UseCaseHttpError) {
      throw new GetMapInteractionModeUseCaseError(error.statusCode as 400 | 403 | 404, error.message)
    }
    throw error
  }
}
