/**
 * POST /api/sessions/start
 *
 * Starts a Track 2 GM-hosted table session. The route fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is present, and still requires the existing local
 * GM role before creating a session-local GM key and player join code.
 */
import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { startGmSessionUseCase } from '../../useCases/startGmSession'

export default defineEventHandler((event) => {
  try {
    assertSessionHostEnabled()
    requireGm(event)
    const result = startGmSessionUseCase()

    return {
      session: result.session,
      gm: result.gm,
      join: result.join,
      snapshot: result.snapshot,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
