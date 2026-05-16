import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { listEncounterTableFoldersUseCase } from '../../useCases/encounterTableLibrary'

export default defineEventHandler((event) => {
  requireGm(event)
  return listEncounterTableFoldersUseCase()
})
