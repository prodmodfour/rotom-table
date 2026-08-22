import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { submitOnboardingDraftUseCase } from '../../../useCases/onboardingSubmission'

interface SubmitBody {
  draftId?: unknown
  profileId?: unknown
  expectedRevision?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<SubmitBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  if (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throwUseCaseHttpError(Object.assign(new Error('expectedRevision must be a non-negative integer'), { statusCode: 400 }))
  }
  try {
    const profile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    return submitOnboardingDraftUseCase({
      role,
      profile,
      draftId: body.draftId,
      expectedRevision: body.expectedRevision as number,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
