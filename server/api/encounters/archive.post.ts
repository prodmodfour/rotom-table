import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { archiveGmEncounterTableUseCase, type MutateGmEncounterTableInput } from '../../useCases/gmEncounterTableLibrary'
import { publishGmCampaignToolkitInvalidation } from '../../utils/gmToolkitRealtime'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<MutateGmEncounterTableInput>(event)
  try {
    const result = archiveGmEncounterTableUseCase(body)
    if (!result.exactRetry) publishGmCampaignToolkitInvalidation({ schemaVersion: 1, domain: 'encounter-table', documentId: result.table.tableId, revision: result.table.revision }, result.operationId)
    return result
  } catch (error) { throwUseCaseHttpError(error) }
})
