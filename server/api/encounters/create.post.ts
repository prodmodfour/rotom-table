import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createEncounterTableUseCase } from '../../useCases/encounterTableLibrary'

interface CreateEncounterTableBody {
  folder?: unknown
  name?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()
  const body = await readObjectBody<CreateEncounterTableBody>(event)

  try {
    return createEncounterTableUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
