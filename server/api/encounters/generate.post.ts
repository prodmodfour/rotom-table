import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { manageWildGenerationUseCase } from '../../useCases/manageWildGeneration'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    return manageWildGenerationUseCase(body)
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
