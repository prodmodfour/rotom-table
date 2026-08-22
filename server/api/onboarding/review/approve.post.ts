import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { approveOnboardingSubmissionUseCase } from '../../../useCases/onboardingApproval'

interface ApproveBody {
  draftId?: unknown
  submissionRevision?: unknown
  confirmDeviations?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<ApproveBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  if (typeof body.submissionRevision !== 'number') {
    throwUseCaseHttpError(Object.assign(new Error('submissionRevision is required'), { statusCode: 400 }))
  }
  try {
    return approveOnboardingSubmissionUseCase({
      role,
      draftId: body.draftId,
      submissionRevision: body.submissionRevision as number,
      confirmDeviations: body.confirmDeviations === true,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
