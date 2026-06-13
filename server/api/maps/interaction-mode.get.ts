import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { getMapInteractionModeUseCase } from '../../useCases/getMapInteractionMode'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return getMapInteractionModeUseCase({
      role,
      slug: getQuery(event).slug,
    })
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
