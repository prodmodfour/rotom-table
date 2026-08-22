import { defineEventHandler, getQuery } from 'h3'
import { requireGm } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  listOnboardedPartyCandidates,
  onboardingEncounterEligibilityUseCase,
} from '../../../useCases/onboardingEncounterJoin'

export default defineEventHandler((event) => {
  const role = requireGm(event)
  const query = getQuery(event)
  try {
    const candidates = listOnboardedPartyCandidates()
    if (typeof query.mapSlug === 'string' && query.mapSlug.trim() !== '') {
      return {
        candidates,
        eligibility: onboardingEncounterEligibilityUseCase({ role, mapSlug: query.mapSlug }),
      }
    }
    return { candidates, eligibility: null }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
