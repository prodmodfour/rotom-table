import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { manageNpcGenerationUseCase } from '../../useCases/manageNpcGeneration'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try { return manageNpcGenerationUseCase(body) }
  catch (error) { throwUseCaseHttpError(error) }
})
