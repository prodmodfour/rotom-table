/**
 * GET /api/sessions/player-profiles
 *
 * Returns a no-secret player lobby view for the currently running live session:
 * the active session summary plus player profile display names/IDs that can be
 * picked for reconnect. It never returns GM keys, join codes, maps, snapshots,
 * assignments, or hidden sheet data.
 */
import { defineEventHandler } from 'h3'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { getPlayerSessionProfilesUseCase } from '../../useCases/getPlayerSessionProfiles'

export default defineEventHandler(() => {
  try {
    assertSessionHostEnabled()
    const result = getPlayerSessionProfilesUseCase()

    return {
      session: result.session,
      profiles: result.profiles,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
