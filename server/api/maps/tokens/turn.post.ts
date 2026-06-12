import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { executeMapTokenLivePlayCommandUseCase, type MapTokenLivePlayCommandResponse } from '../../../useCases/applyMapTokenAction'

type TurnTokenBody = Record<string, unknown>

const bodyField = (body: TurnTokenBody, key: string): unknown => body[key]

const routeResponse = (response: MapTokenLivePlayCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.placement === undefined ? {} : { placement: response.placement }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<TurnTokenBody>(event)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null
    const response = await executeMapTokenLivePlayCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
