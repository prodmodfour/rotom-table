import { defineEventHandler, getRouterParam } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { getGmEncounterTableUseCase } from '../../../useCases/gmEncounterTableLibrary'

export default defineEventHandler((event) => {
  requireGm(event)
  try {
    return getGmEncounterTableUseCase({ tableId: getRouterParam(event, 'tableId') })
  } catch (error) { throwUseCaseHttpError(error) }
})
