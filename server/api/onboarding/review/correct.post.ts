import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  applyOnboardingCorrectionUseCase,
  type OnboardingCorrectionScope,
} from '../../../useCases/onboardingCorrections'

interface CorrectBody {
  draftId?: unknown
  submissionRevision?: unknown
  scope?: unknown
  buildIndex?: unknown
  value?: unknown
  rationale?: unknown
  requiresAcknowledgement?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<CorrectBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  if (typeof body.submissionRevision !== 'number') {
    throwUseCaseHttpError(Object.assign(new Error('submissionRevision is required'), { statusCode: 400 }))
  }
  try {
    return applyOnboardingCorrectionUseCase({
      role,
      draftId: body.draftId,
      submissionRevision: body.submissionRevision as number,
      scope: body.scope as OnboardingCorrectionScope,
      buildIndex: typeof body.buildIndex === 'number' ? body.buildIndex : undefined,
      value: body.value === null ? null : typeof body.value === 'string' ? body.value : null,
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
      requiresAcknowledgement: body.requiresAcknowledgement !== false,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
