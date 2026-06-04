import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { deleteEncounterTableFolderUseCase } from '../../useCases/encounterTableLibrary'

interface DeleteEncounterTableFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<DeleteEncounterTableFolderBody>(event)

  try {
    return deleteEncounterTableFolderUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
