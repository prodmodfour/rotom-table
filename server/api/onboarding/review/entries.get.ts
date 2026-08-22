import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { createSqliteOnboardingRepository } from '../../../storage/onboardingRepository'
import { OnboardingUseCaseError } from '../../../useCases/onboardingWorkflows'

/** Role-projected review history: players receive table-audience entries for
 *  their own draft only; the GM receives everything including gm-only notes. */
export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const repository = createSqliteOnboardingRepository()
    const stored = (() => {
      try {
        return repository.getDraft(query.draftId)
      } catch {
        throw new OnboardingUseCaseError(400, 'draftId is invalid')
      }
    })()
    if (!stored) throw new OnboardingUseCaseError(404, 'Draft not found')
    if (role === 'gm') {
      return { entries: repository.listReviewEntries(stored.draft.draftId, { includeGmOnly: true }) }
    }
    const profile = resolvePlayerProfileForPolicy(query.profileId)
    if (!profile || profile.id !== stored.draft.profileId) {
      throw new OnboardingUseCaseError(404, 'Draft not found')
    }
    return { entries: repository.listReviewEntries(stored.draft.draftId) }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
