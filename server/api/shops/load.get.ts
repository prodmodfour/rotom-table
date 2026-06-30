import { defineEventHandler, getQuery } from 'h3'
import { loadShopTableUseCase } from '../../useCases/shopTableRead'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return loadShopTableUseCase({
      role,
      slug: getQuery(event).slug,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
