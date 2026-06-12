import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { executeLivePlayTableActionCommandUseCase, type LivePlayTableActionCommandResponse } from '../../../useCases/applyMapTokenTableAction'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

type UseManeuverBody = Record<string, unknown>

const bodyField = (body: UseManeuverBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlayTableActionCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.placement === undefined ? {} : { placement: response.placement }),
    ...(response.action === undefined ? {} : { action: response.action }),
    ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<UseManeuverBody>(event)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null
    const response = await executeLivePlayTableActionCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
