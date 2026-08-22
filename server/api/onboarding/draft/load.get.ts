import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { loadOnboardingDraftUseCase } from '../../../useCases/onboardingWorkflows'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const profile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    return loadOnboardingDraftUseCase({ role, profile, draftId: query.draftId })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
