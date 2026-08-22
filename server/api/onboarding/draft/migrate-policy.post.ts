import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { migrateOnboardingDraftPolicyUseCase } from '../../../useCases/onboardingWorkflows'

interface MigrateBody {
  draftId?: unknown
  apply?: unknown
  expectedRevision?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<MigrateBody>(event)
  try {
    return migrateOnboardingDraftPolicyUseCase({
      role,
      draftId: body.draftId,
      apply: body.apply === true,
      expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      operationId: typeof body.operationId === 'string' ? body.operationId : undefined,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
