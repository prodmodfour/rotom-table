import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  executeLivePlayUseMoveCommandUseCase,
  type LivePlayUseMoveCommandResponse,
} from '../../useCases/applyLivePlayUseMoveCommand'

interface UseMoveBody extends Record<string, unknown> {
  clientId?: unknown
  profileId?: unknown
}

const bodyField = (body: UseMoveBody, key: string): unknown => body[key]

const livePlayRouteResponse = (response: LivePlayUseMoveCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.placement === undefined ? {} : { placement: response.placement }),
    ...(response.usage === undefined ? {} : { usage: response.usage }),
    ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<UseMoveBody>(event)
  const clientId = normalizeRealtimeClientId(bodyField(body, 'clientId'))

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null

    const response = await executeLivePlayUseMoveCommandUseCase({
      role,
      command: body,
      clientId,
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
    })
    return livePlayRouteResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
