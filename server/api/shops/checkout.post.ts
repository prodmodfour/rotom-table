import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  executeShopCheckoutCommandUseCase,
  type ExecuteShopCheckoutCommandUseCaseResponse,
} from '../../useCases/executeShopCheckoutCommand'

type ShopCheckoutRouteBody = Record<string, unknown>

const requireShopCheckoutCommandEnvelope = (
  body: ShopCheckoutRouteBody,
): ShopCheckoutRouteBody => {
  if (body.type !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT) {
    badRequest('request body must be a SHOP_CHECKOUT live-play command envelope')
  }
  return body
}

const routeResponse = (response: ExecuteShopCheckoutCommandUseCaseResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.shop === undefined ? {} : { shop: response.shop }),
    ...(response.groupInventories === undefined ? {} : { groupInventories: response.groupInventories }),
    ...(response.trainerSheets === undefined ? {} : { trainerSheets: response.trainerSheets }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<ShopCheckoutRouteBody>(event)
  const command = requireShopCheckoutCommandEnvelope(body)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(command.profileId)
      : null

    const response = executeShopCheckoutCommandUseCase({
      role,
      command,
      clientId: normalizeRealtimeClientId(command.clientId),
      playerProfile,
    })

    return routeResponse(response)
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
