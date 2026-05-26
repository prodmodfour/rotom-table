/**
 * POST /api/sessions/assignments
 *
 * Lets the GM assign or unassign player-controllable sheet/token resources in an
 * active live session. The route fails closed unless
 * ROTOM_ENABLE_SESSION_HOST=1 is present and requires the session-local GM key;
 * the trust-based local role picker is not treated as public authentication.
 */
import { defineEventHandler, readBody } from 'h3'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  updatePlayerAssignmentUseCase,
  type UpdatePlayerAssignmentInput,
} from '../../useCases/updatePlayerAssignment'

export default defineEventHandler(async (event) => {
  try {
    assertSessionHostEnabled()
    const body = await readBody<UpdatePlayerAssignmentInput | null>(event)
    const result = updatePlayerAssignmentUseCase(body ?? {})

    return {
      session: result.session,
      player: result.player,
      assignment: result.assignment,
      change: result.change,
      snapshot: result.snapshot,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
