/**
 * POST /api/sessions/join
 *
 * Lets a player join the currently running live session by creating a sanitized
 * display-name profile or picking an existing player profile. A legacy join code
 * can still target a specific session, but the normal player flow does not
 * require one. The route fails closed unless ROTOM_ENABLE_SESSION_HOST=1 is
 * present and intentionally does not use the existing local role picker as
 * public auth.
 */
import { defineEventHandler, readBody } from 'h3'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { joinPlayerSessionUseCase, type JoinPlayerSessionInput } from '../../useCases/joinPlayerSession'

export default defineEventHandler(async (event) => {
  try {
    assertSessionHostEnabled()
    const body = await readBody<JoinPlayerSessionInput | null>(event)
    const result = joinPlayerSessionUseCase(body ?? {})

    return {
      session: result.session,
      player: result.player,
      snapshot: result.snapshot,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
