/**
 * POST /api/sessions/join
 *
 * Lets a player join an active Track 2 GM-hosted table session with a short
 * join code and a sanitized display name. The route fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is present and intentionally does not use the
 * existing local role picker as public auth.
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
