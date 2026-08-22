import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { cancelOnboardingSlotUseCase } from '../../../useCases/onboardingWorkflows'

interface CancelBody {
  slotId?: unknown
  profileId?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<CancelBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  try {
    const profile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    return cancelOnboardingSlotUseCase({
      role,
      profile,
      slotId: body.slotId,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
