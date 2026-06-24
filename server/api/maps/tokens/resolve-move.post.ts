import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandResponse,
} from '../../../useCases/applyResolveMoveCommand'

type ResolveMoveBody = Record<string, unknown>

const bodyField = (body: ResolveMoveBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlayResolveMoveCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
    ...(response.move === undefined ? {} : { move: response.move }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<ResolveMoveBody>(event)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null
    const response = await executeLivePlayResolveMoveCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
