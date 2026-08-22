import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  loadGmOnboardingOverviewUseCase,
  loadPlayerOnboardingHomeUseCase,
} from '../../useCases/onboardingWorkflows'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    if (role === 'gm') return loadGmOnboardingOverviewUseCase({ role })
    const profile = resolvePlayerProfileForPolicy(getQuery(event).profileId)
    return loadPlayerOnboardingHomeUseCase({ role, profile })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
