import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { MapInteractionMode } from '#shared/mapInteractionMode'
import type { RealtimeEvent } from '#shared/realtime'
import { mapInteractionModeUpdatedRealtimeEvent } from '../utils/mapRealtimeEvents'
import {
  sqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class SetMapInteractionModeUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface SetMapInteractionModeInput {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly clientId?: string
}

export interface SetMapInteractionModeDependencies {
  readonly modeRepository?: Pick<MapInteractionModeRepository, 'get' | 'set'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug'>
  readonly now?: () => number
}

export interface SetMapInteractionModeResult {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly previousInteractionMode: MapInteractionMode
  readonly updatedAt: number
  readonly syncedMapForLivePlay: boolean
  readonly events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const setMapInteractionModeUseCase = (
  input: SetMapInteractionModeInput,
  dependencies: SetMapInteractionModeDependencies = {},
): SetMapInteractionModeResult => {
  const modeRepository = dependencies.modeRepository ?? sqliteMapInteractionModeRepository
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const now = dependencies.now ?? Date.now

  const map = mapRepository.getBySlug(input.slug)
  if (!map) throw new SetMapInteractionModeUseCaseError(404, `Map ${input.slug}.json not found`)

  const previousInteractionMode = modeRepository.get(input.slug).interactionMode
  const updatedAt = now()
  const state = modeRepository.set({
    slug: input.slug,
    interactionMode: input.interactionMode,
    updatedAt,
  })

  return {
    slug: state.slug,
    interactionMode: state.interactionMode,
    previousInteractionMode,
    updatedAt: state.updatedAt,
    syncedMapForLivePlay: false,
    events: [mapInteractionModeUpdatedRealtimeEvent(state.slug, state.interactionMode, state.updatedAt, input.clientId)],
  }
}
