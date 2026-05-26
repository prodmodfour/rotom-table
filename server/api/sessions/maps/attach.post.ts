/**
 * POST /api/sessions/maps/attach
 *
 * Attaches a persisted map to an active live session as server-owned session
 * map state. The route fails closed unless ROTOM_ENABLE_SESSION_HOST=1 is
 * present and requires the session-local GM key instead of trusting the local
 * role picker as public authority.
 */
import { defineEventHandler, readBody } from 'h3'
import { assertSessionHostEnabled } from '../../../utils/sessionHosting'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  attachSessionMapUseCase,
  type AttachSessionMapUseCaseInput,
} from '../../../useCases/attachSessionMap'

export default defineEventHandler(async (event) => {
  try {
    assertSessionHostEnabled()
    const body = await readBody<AttachSessionMapUseCaseInput | null>(event)
    const result = attachSessionMapUseCase(body ?? {})

    return {
      session: result.session,
      map: result.map,
      selection: result.selection,
      visibility: result.visibility,
      snapshot: result.snapshot,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
