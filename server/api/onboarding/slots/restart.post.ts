import { defineEventHandler } from 'h3'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { restartOnboardingSlotUseCase } from '../../../useCases/onboardingWorkflows'

interface RestartBody {
  slotId?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<RestartBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  try {
    const result = restartOnboardingSlotUseCase({
      role,
      slotId: body.slotId,
      operationId: body.operationId as string,
    })
    return {
      ok: true,
      supersededSlotId: result.supersededSlotId,
      slot: result.slot,
      draftId: result.draft.draft.draftId,
    }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
