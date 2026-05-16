import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { moveEncounterTableUseCase } from '../../useCases/encounterTableLibrary'

interface MoveEncounterTableBody {
  region?: unknown
  key?: unknown
  folder?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()
  const body = await readObjectBody<MoveEncounterTableBody>(event)

  try {
    return moveEncounterTableUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
