import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { acknowledgeOnboardingCorrectionUseCase } from '../../../useCases/onboardingCorrections'

interface AcknowledgeBody {
  draftId?: unknown
  profileId?: unknown
  correctionEntryId?: unknown
  operationId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<AcknowledgeBody>(event)
  if (typeof body.operationId !== 'string' || body.operationId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('operationId is required'), { statusCode: 400 }))
  }
  if (typeof body.correctionEntryId !== 'string' || body.correctionEntryId.length < 8) {
    throwUseCaseHttpError(Object.assign(new Error('correctionEntryId is required'), { statusCode: 400 }))
  }
  try {
    const profile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    return acknowledgeOnboardingCorrectionUseCase({
      role,
      profile,
      draftId: body.draftId,
      correctionEntryId: body.correctionEntryId as string,
      operationId: body.operationId as string,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
