import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { joinOnboardedPartyUseCase } from '../../../useCases/onboardingEncounterJoin'

interface JoinBody {
  trainerSlug?: unknown
  mapSlug?: unknown
  sideId?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<JoinBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  try {
    return joinOnboardedPartyUseCase({
      role,
      trainerSlug: body.trainerSlug,
      mapSlug: body.mapSlug,
      sideId: body.sideId,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
