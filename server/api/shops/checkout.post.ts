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
import {
  projectSheetEquipmentContributions,
  redactSheetRecordForPlayer,
} from '../../utils/sheetPrivacy'
import { projectGroupInventoryForPlayer } from '../../utils/groupInventoryPrivacy'

type ShopCheckoutRouteBody = Record<string, unknown>

const requireShopCheckoutCommandEnvelope = (
  body: ShopCheckoutRouteBody,
): ShopCheckoutRouteBody => {
  if (body.type !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT) {
    badRequest('request body must be a SHOP_CHECKOUT live-play command envelope')
  }
  return body
}

const projectTrainerSheetForRole = (role: AuthRole, sheet: Record<string, unknown>) => (
  role === 'player'
    ? redactSheetRecordForPlayer('trainer', sheet)
    : projectSheetEquipmentContributions('trainer', sheet)
)

const projectAcceptedResultForRole = (
  result: ShopCheckoutCommandAccepted,
  role: AuthRole,
): ShopCheckoutCommandAccepted => ({
  ...result,
  documents: {
    ...result.documents,
    shop: role === 'player' ? redactShopForPlayer(result.documents.shop) : result.documents.shop,
    ...(result.documents.groupInventories ? {
      groupInventories: role === 'player'
        ? result.documents.groupInventories.map(projectGroupInventoryForPlayer)
        : result.documents.groupInventories,
    } : {}),
    ...(result.documents.trainerSheets ? {
      trainerSheets: result.documents.trainerSheets.map(sheet => projectTrainerSheetForRole(
        role,
        sheet as unknown as Record<string, unknown>,
      ) as unknown as typeof sheet),
    } : {}),
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

const projectResultForRole = (
  result: ShopCheckoutCommandResult,
  role: AuthRole,
): ShopCheckoutCommandResult => {
  if (result.ok === true && 'duplicate' in result) {
    return {
      ...result,
      original: projectResultForRole(
        result.original,
        role,
      ) as ShopCheckoutCommandAccepted | ShopCheckoutCommandRejected,
    }
  }

  if (result.ok === true) return projectAcceptedResultForRole(result, role)
  return role === 'player' ? redactRejectedResultForPlayer(result) : result
}

const routeResponse = (response: ExecuteShopCheckoutCommandUseCaseResponse, role: AuthRole) => {
  const result = projectResultForRole(response.result, role)
  if (!result.ok) return result
  return {
    ...result,
    ...(response.shop === undefined ? {} : { shop: role === 'player' ? redactShopForPlayer(response.shop) : response.shop }),
    ...(response.groupInventories === undefined ? {} : {
      groupInventories: role === 'player'
        ? response.groupInventories.map(projectGroupInventoryForPlayer)
        : response.groupInventories,
    }),
    ...(response.trainerSheets === undefined ? {} : {
      trainerSheets: response.trainerSheets.map(sheet => projectTrainerSheetForRole(
        role,
        sheet as unknown as Record<string, unknown>,
      )),
    }),
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
