import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { renameEncounterTableUseCase } from '../../useCases/encounterTableLibrary'

interface RenameEncounterTableBody {
  region?: unknown
  key?: unknown
  name?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<RenameEncounterTableBody>(event)

  try {
    return renameEncounterTableUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
