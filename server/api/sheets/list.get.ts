import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { requireNonProduction } from '../../utils/http'
import { listSheetsUseCase } from '../../useCases/listSheets'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  if (role === 'gm') requireNonProduction()
  return listSheetsUseCase({ role })
})
