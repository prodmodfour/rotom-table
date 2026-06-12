import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  executeLivePlayMapEffectsCommandUseCase,
  type LivePlayMapEffectsCommandResponse,
} from '../../../useCases/applyLivePlayMapEffectsCommand'

type RemoveHazardBody = Record<string, unknown>

const bodyField = (body: RemoveHazardBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlayMapEffectsCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.hazards === undefined ? {} : { hazards: response.hazards }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<RemoveHazardBody>(event)

  try {
    const response = await executeLivePlayMapEffectsCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      expectedType: LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
