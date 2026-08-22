import { defineEventHandler, getQuery } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { loadOnboardingReviewUseCase } from '../../../useCases/onboardingApproval'

export default defineEventHandler((event) => {
  const role = requireGm(event)
  try {
    return loadOnboardingReviewUseCase({ role, draftId: getQuery(event).draftId })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
