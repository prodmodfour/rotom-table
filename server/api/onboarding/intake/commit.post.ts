import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { commitOnboardingIntakeUseCase } from '../../../useCases/onboardingIntake'

interface IntakeCommitBody {
  trainerSlug?: unknown
  profileId?: unknown
  acceptedRepairIds?: unknown
  resolveOwnershipConflicts?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<IntakeCommitBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  try {
    return commitOnboardingIntakeUseCase({
      role,
      trainerSlug: body.trainerSlug,
      profileId: body.profileId,
      acceptedRepairIds: Array.isArray(body.acceptedRepairIds) ? body.acceptedRepairIds.map(String) : [],
      resolveOwnershipConflicts: body.resolveOwnershipConflicts === true,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
