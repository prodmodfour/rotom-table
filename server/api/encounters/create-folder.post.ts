import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createEncounterTableFolderUseCase } from '../../useCases/encounterTableLibrary'

interface CreateEncounterTableFolderBody {
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()
  const body = await readObjectBody<CreateEncounterTableFolderBody>(event)

  try {
    return createEncounterTableFolderUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
