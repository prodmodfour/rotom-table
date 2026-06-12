import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  executeLivePlayInitiativeCommandUseCase,
  type LivePlayInitiativeCommandResponse,
} from '../../../useCases/applyLivePlayInitiativeCommand'

type NextInitiativeBody = Record<string, unknown>

const bodyField = (body: NextInitiativeBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlayInitiativeCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.initiative === undefined ? {} : { initiative: response.initiative }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<NextInitiativeBody>(event)

  try {
    const response = await executeLivePlayInitiativeCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      expectedType: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
