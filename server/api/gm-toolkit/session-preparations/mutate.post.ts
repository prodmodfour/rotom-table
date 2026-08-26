import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { manageSessionPreparationUseCase } from '../../../useCases/manageSessionPreparation'
import { publishGmCampaignToolkitInvalidation } from '../../../utils/gmToolkitRealtime'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    const result = manageSessionPreparationUseCase(body)
    if (!result.exactRetry) publishGmCampaignToolkitInvalidation({ schemaVersion: 1, domain: 'session-preparation', documentId: result.preparation.preparationId, revision: result.preparation.revision }, result.operationId)
    return result
  } catch (error) { throwUseCaseHttpError(error) }
})
