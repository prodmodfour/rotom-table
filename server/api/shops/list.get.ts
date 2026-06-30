import { defineEventHandler } from 'h3'
import { listShopTablesUseCase } from '../../useCases/shopTableRead'
import { requireAuthRole } from '../../utils/auth'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  return listShopTablesUseCase({ role })
})
