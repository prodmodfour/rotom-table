import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { moveEncounterTableFolderUseCase } from '../../useCases/encounterTableLibrary'

interface MoveEncounterTableFolderBody {
  from?: unknown
  to?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<MoveEncounterTableFolderBody>(event)

  try {
    return moveEncounterTableFolderUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
