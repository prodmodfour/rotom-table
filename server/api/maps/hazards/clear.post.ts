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

type ClearHazardsBody = Record<string, unknown>

const bodyField = (body: ClearHazardsBody, key: string): unknown => body[key]

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

  const body = await readObjectBody<ClearHazardsBody>(event)

  try {
    const response = await executeLivePlayMapEffectsCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
