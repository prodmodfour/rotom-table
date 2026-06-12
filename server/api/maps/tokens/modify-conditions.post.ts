import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { executeLivePlaySheetCommandUseCase, type LivePlaySheetCommandResponse } from '../../../useCases/applyLivePlaySheetCommand'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

type ModifyConditionsBody = Record<string, unknown>

const bodyField = (body: ModifyConditionsBody, key: string): unknown => body[key]

const routeResponse = (response: LivePlaySheetCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.placement === undefined ? {} : { placement: response.placement }),
    ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<ModifyConditionsBody>(event)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null
    const response = await executeLivePlaySheetCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
