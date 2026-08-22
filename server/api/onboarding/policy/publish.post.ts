import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { publishOnboardingPolicyUseCase } from '../../../useCases/onboardingWorkflows'

interface PublishBody {
  content?: unknown
  display?: { name?: unknown, description?: unknown }
  policyId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<PublishBody>(event)
  try {
    return publishOnboardingPolicyUseCase({
      role,
      content: body.content,
      display: body.display ?? {},
      policyId: body.policyId,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
