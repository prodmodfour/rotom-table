import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  executeStartTurnModalLivePlayCommandUseCase,
  type StartTurnModalLivePlayCommandResponse,
} from '../../../useCases/applyStartTurnModalCommand'

type StartTurnModalBody = Record<string, unknown>

const bodyField = (body: StartTurnModalBody, key: string): unknown => body[key]

const routeResponse = (response: StartTurnModalLivePlayCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<StartTurnModalBody>(event)

  try {
    const response = await executeStartTurnModalLivePlayCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
