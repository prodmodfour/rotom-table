import { defineEventHandler, getQuery } from 'h3'
import { loadGroupInventoryUseCase } from '../../useCases/loadGroupInventory'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return loadGroupInventoryUseCase({
      role,
      slug: getQuery(event).slug,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
