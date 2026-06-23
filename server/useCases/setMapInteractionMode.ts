import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  MAP_INTERACTION_MODES,
  type MapInteractionMode,
} from '#shared/mapInteractionMode'
import type { RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'
import { findMapFile, readMapFile } from '../utils/mapStorage'
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
  readonly findMapPath?: (slug: string) => string | null
  readonly readMap?: (filePath: string) => TabletopMap
  readonly modeRepository?: Pick<MapInteractionModeRepository, 'get' | 'set'>
  readonly mapRepository?: Pick<MapRepository, 'saveSetupMap'>
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

export const setMapInteractionModeUseCase = async (
  input: SetMapInteractionModeInput,
  dependencies: SetMapInteractionModeDependencies = {},
): Promise<SetMapInteractionModeResult> => {
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile
  const modeRepository = dependencies.modeRepository ?? sqliteMapInteractionModeRepository
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const now = dependencies.now ?? Date.now

  const mapPath = findMapPath(input.slug)
  if (!mapPath) throw new SetMapInteractionModeUseCaseError(404, `Map ${input.slug}.json not found`)

  const previousInteractionMode = modeRepository.get(input.slug).interactionMode
  let syncedMapForLivePlay = false

  if (
    previousInteractionMode !== MAP_INTERACTION_MODES.LIVE_PLAY
    && input.interactionMode === MAP_INTERACTION_MODES.LIVE_PLAY
  ) {
    let map: TabletopMap
    try {
      map = readMap(mapPath)
    } catch (error) {
      throw new SetMapInteractionModeUseCaseError(
        400,
        error instanceof Error ? error.message : `Map ${input.slug}.json is invalid`,
      )
    }
    mapRepository.saveSetupMap(map)
    syncedMapForLivePlay = true
  }

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
    syncedMapForLivePlay,
    events: [mapInteractionModeUpdatedRealtimeEvent(state.slug, state.interactionMode, state.updatedAt, input.clientId)],
  }
}
