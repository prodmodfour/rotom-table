import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { declareSheetItemActionUseCase } from '../../../useCases/declareSheetItemAction'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const allowed = new Set(['intent', 'profileId'])
  if (!Object.hasOwn(body, 'intent') || Object.keys(body).some(key => !allowed.has(key))) {
    badRequest('Sheet item declaration must contain only intent and profileId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  try {
    return declareSheetItemActionUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
      intent: body.intent,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
