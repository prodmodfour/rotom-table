import { defineEventHandler } from 'h3'
import { resolveCapabilityAdjudicationUseCase } from '../../../../useCases/resolveCapabilityAdjudication'
import { requireAuthRole } from '../../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../../utils/http'
import { throwUseCaseHttpError } from '../../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    return resolveCapabilityAdjudicationUseCase({ role, command: body.command })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
