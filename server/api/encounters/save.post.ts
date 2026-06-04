import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { saveEncounterTableUseCase } from '../../useCases/encounterTableLibrary'

interface SaveEncounterTableBody {
  region?: unknown
  key?: unknown
  table?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<SaveEncounterTableBody>(event)

  try {
    return saveEncounterTableUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
