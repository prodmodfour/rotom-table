import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { createOnboardingSlotUseCase } from '../../../useCases/onboardingWorkflows'

interface CreateSlotBody {
  profileId?: unknown
  newProfileDisplayName?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<CreateSlotBody>(event)
  try {
    const result = createOnboardingSlotUseCase({
      role,
      profileId: body.profileId,
      newProfileDisplayName: body.newProfileDisplayName,
    })
    return {
      ok: true,
      slot: result.slot,
      draftId: result.draft.draft.draftId,
      profile: result.profile,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
