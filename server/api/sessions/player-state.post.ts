/**
 * POST /api/sessions/player-state
 *
 * Returns the player-filtered state summary for one Track 2 table session:
 * the caller's own player identity, assignment record, current-map visibility,
 * and lifecycle status. The route fails closed unless ROTOM_ENABLE_SESSION_HOST=1
 * is present and validates the session-local player identity instead of trusting
 * the local role picker as public authentication.
 */
import { defineEventHandler, readBody } from 'h3'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  getPlayerSessionStateUseCase,
  type GetPlayerSessionStateInput,
} from '../../useCases/getPlayerSessionState'

export default defineEventHandler(async (event) => {
  try {
    assertSessionHostEnabled()
    const body = await readBody<GetPlayerSessionStateInput | null>(event)
    const result = getPlayerSessionStateUseCase(body ?? {})

    return {
      session: result.session,
      player: result.player,
      assignment: result.assignment,
      visibility: result.visibility,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
