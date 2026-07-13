import { defineEventHandler, getQuery } from 'h3'
import { getGmMoveCorrectionDetailsUseCase } from '../../../useCases/getGmMoveCorrectionDetails'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireGm(event)
  const query = getQuery(event)

  try {
    return getGmMoveCorrectionDetailsUseCase({
      role,
      mapSlug: query.slug,
      originOperationId: query.originOperationId,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
