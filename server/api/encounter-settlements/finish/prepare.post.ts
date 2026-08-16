import { defineEventHandler } from 'h3'
import { prepareFinishEncounter } from '../../../useCases/prepareFinishEncounter'
import { requireGm } from '../../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'encounterId')) {
    badRequest('Finish Encounter preparation accepts exactly one encounterId field.')
  }
  try {
    return prepareFinishEncounter({ role, encounterId: body.encounterId }).view
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
