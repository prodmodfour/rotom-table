import { defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { exportGmEncounterTableUseCase } from '../../../useCases/gmEncounterTableLibrary'

export default defineEventHandler((event) => {
  requireGm(event)
  try {
    const result = exportGmEncounterTableUseCase({ tableId: getRouterParam(event, 'tableId') })
    setResponseHeader(event, 'Content-Disposition', 'attachment; filename="encounter-table.v1.json"')
    return result
  } catch (error) { throwUseCaseHttpError(error) }
})
