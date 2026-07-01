import { defineEventHandler } from 'h3'
import type { AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutCommandResult,
} from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  executeShopCheckoutCommandUseCase,
  type ExecuteShopCheckoutCommandUseCaseResponse,
} from '../../useCases/executeShopCheckoutCommand'
import { redactShopForPlayer, redactUnknownShopRecordForPlayer } from '../../utils/shopPrivacy'

type ShopCheckoutRouteBody = Record<string, unknown>

const requireShopCheckoutCommandEnvelope = (
  body: ShopCheckoutRouteBody,
): ShopCheckoutRouteBody => {
  if (body.type !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT) {
    badRequest('request body must be a SHOP_CHECKOUT live-play command envelope')
  }
  return body
}

const redactAcceptedResultForPlayer = (
  result: ShopCheckoutCommandAccepted,
): ShopCheckoutCommandAccepted => ({
  ...result,
  documents: {
    ...result.documents,
    shop: redactShopForPlayer(result.documents.shop),
  },
})

const redactRejectedResultForPlayer = (
  result: ShopCheckoutCommandRejected,
): ShopCheckoutCommandRejected => ({
  ...result,
  ...(result.currentState === undefined
    ? {}
    : { currentState: redactUnknownShopRecordForPlayer(result.currentState) }),
})

const redactResultForPlayer = (result: ShopCheckoutCommandResult): ShopCheckoutCommandResult => {
  if (result.ok === true && 'duplicate' in result) {
    return {
      ...result,
      original: redactResultForPlayer(result.original) as ShopCheckoutCommandAccepted | ShopCheckoutCommandRejected,
    }
  }

  if (result.ok === true) return redactAcceptedResultForPlayer(result)
  return redactRejectedResultForPlayer(result)
}

const responseResultForRole = (
  role: AuthRole,
  result: ShopCheckoutCommandResult,
): ShopCheckoutCommandResult => (role === 'player' ? redactResultForPlayer(result) : result)

const routeResponse = (response: ExecuteShopCheckoutCommandUseCaseResponse, role: AuthRole) => {
  const result = responseResultForRole(role, response.result)
  if (!result.ok) return result
  return {
    ...result,
    ...(response.shop === undefined ? {} : { shop: role === 'player' ? redactShopForPlayer(response.shop) : response.shop }),
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

    return routeResponse(response, role)
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
