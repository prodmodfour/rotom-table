import { defineEventHandler } from 'h3'
import { parseShopPostCheckoutActionRequest } from '#shared/shopPostCheckout'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadShopPostCheckoutActionsUseCase } from '../../useCases/loadShopPostCheckoutActions'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

type RequestBody = Record<string, unknown>

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<RequestBody>(event)
  if (Object.keys(body).some(key => !['request', 'profileId'].includes(key)) || !Object.hasOwn(body, 'request')) {
    return badRequest('Post-checkout action request has an invalid shape.')
  }
  let request
  try { request = parseShopPostCheckoutActionRequest(body.request) }
  catch (error) { return badRequest(error instanceof Error ? error.message : 'Post-checkout action request is invalid.') }
  try {
    return loadShopPostCheckoutActionsUseCase({
      role,
      request,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
