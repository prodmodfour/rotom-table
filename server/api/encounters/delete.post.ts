import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { deleteEncounterTableUseCase } from '../../useCases/encounterTableLibrary'

interface DeleteEncounterTableBody {
  region?: unknown
  key?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()
  const body = await readObjectBody<DeleteEncounterTableBody>(event)

  try {
    return deleteEncounterTableUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
