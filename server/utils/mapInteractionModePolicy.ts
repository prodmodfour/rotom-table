import { conflict } from './http'
import {
  LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE,
  MAP_INTERACTION_MODES,
  SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE,
  type MapInteractionMode,
} from '#shared/mapInteractionMode'
import {
  sqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'

export const currentMapInteractionMode = (
  slug: string,
  repository: Pick<MapInteractionModeRepository, 'get'> = sqliteMapInteractionModeRepository,
): MapInteractionMode => repository.get(slug).interactionMode

export const requireSetupEditMapInteractionMode = (
  slug: string,
  repository: Pick<MapInteractionModeRepository, 'get'> = sqliteMapInteractionModeRepository,
): void => {
  if (currentMapInteractionMode(slug, repository) !== MAP_INTERACTION_MODES.SETUP_EDIT) {
    conflict(SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE)
  }
}

export const requireRunLivePlayMapInteractionMode = (
  slug: string,
  repository: Pick<MapInteractionModeRepository, 'get'> = sqliteMapInteractionModeRepository,
): void => {
  if (currentMapInteractionMode(slug, repository) !== MAP_INTERACTION_MODES.LIVE_PLAY) {
    conflict(LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE)
  }
}
