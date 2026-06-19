import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import {
  executeAttackOfOpportunityLivePlayCommandUseCase,
  type AttackOfOpportunityLivePlayCommandResponse,
} from '../../../useCases/applyAttackOfOpportunityCommand'

type AttackOfOpportunityBody = Record<string, unknown>

const bodyField = (body: AttackOfOpportunityBody, key: string): unknown => body[key]

const routeResponse = (response: AttackOfOpportunityLivePlayCommandResponse) => {
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

  const body = await readObjectBody<AttackOfOpportunityBody>(event)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null
    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role,
      command: body,
      clientId: normalizeRealtimeClientId(bodyField(body, 'clientId')),
      playerProfile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    })
    return routeResponse(response)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
