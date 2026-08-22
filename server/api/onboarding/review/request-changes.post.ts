import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { requestOnboardingChangesUseCase } from '../../../useCases/onboardingApproval'

interface RequestChangesBody {
  draftId?: unknown
  submissionRevision?: unknown
  reasons?: unknown
  comment?: unknown
  gmOnlyNote?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<RequestChangesBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  if (typeof body.submissionRevision !== 'number') {
    throwUseCaseHttpError(Object.assign(new Error('submissionRevision is required'), { statusCode: 400 }))
  }
  const reasons = Array.isArray(body.reasons) ? body.reasons.map(String) : []
  try {
    return requestOnboardingChangesUseCase({
      role,
      draftId: body.draftId,
      submissionRevision: body.submissionRevision as number,
      reasons,
      comment: typeof body.comment === 'string' ? body.comment : undefined,
      gmOnlyNote: typeof body.gmOnlyNote === 'string' ? body.gmOnlyNote : undefined,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
