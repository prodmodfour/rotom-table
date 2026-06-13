import { createAuthoritativeLivePlayCommandExecutor } from './commandExecutor'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import { sqliteMapInteractionModeRepository } from '../storage/mapInteractionModeRepository'

export const createSqliteAuthoritativeLivePlayCommandExecutor = () => createAuthoritativeLivePlayCommandExecutor({
  opStore: sqliteLivePlayOpRepository,
  readMapInteractionMode: (mapSlug) => sqliteMapInteractionModeRepository.get(mapSlug).interactionMode,
})
