import { defineEventHandler, getQuery } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { listGmEncounterTablesUseCase } from '../../useCases/gmEncounterTableLibrary'

export default defineEventHandler((event) => {
  requireGm(event)
  try {
    const query = getQuery(event)
    return listGmEncounterTablesUseCase({ includeArchived: query.includeArchived === 'true' })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
