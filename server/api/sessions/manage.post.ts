/**
 * POST /api/sessions/manage
 *
 * Returns the GM management summary for one live session: join code,
 * joined players, connected clients, assignments, and lifecycle status. The
 * route fails closed unless ROTOM_ENABLE_SESSION_HOST=1 is present and requires
 * the session-local GM key rather than trusting the local role picker as public
 * authentication.
 */
import { defineEventHandler, readBody } from 'h3'
import { assertSessionHostEnabled } from '../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  getGmSessionManagementUseCase,
  type GetGmSessionManagementInput,
} from '../../useCases/getGmSessionManagement'

export default defineEventHandler(async (event) => {
  try {
    assertSessionHostEnabled()
    const body = await readBody<GetGmSessionManagementInput | null>(event)
    const result = getGmSessionManagementUseCase(body ?? {})

    return {
      session: result.session,
      join: result.join,
      players: result.players,
      connectedClients: result.connectedClients,
      assignments: result.assignments,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
