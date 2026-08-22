import { defineEventHandler, getQuery } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { previewOnboardingIntakeUseCase } from '../../../useCases/onboardingIntake'

export default defineEventHandler((event) => {
  const role = requireGm(event)
  const query = getQuery(event)
  try {
    return previewOnboardingIntakeUseCase({
      role,
      trainerSlug: query.trainerSlug,
      profileId: query.profileId,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
