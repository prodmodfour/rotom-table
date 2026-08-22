import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { saveOnboardingDraftUseCase } from '../../../useCases/onboardingWorkflows'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface SaveDraftBody {
  draftId?: unknown
  profileId?: unknown
  expectedRevision?: unknown
  document?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<SaveDraftBody>(event)
  const expectedRevision = body.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throwUseCaseHttpError(Object.assign(new Error('expectedRevision must be a non-negative integer'), { statusCode: 400 }))
  }
  try {
    const profile = role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null
    return saveOnboardingDraftUseCase({
      role,
      profile,
      draftId: body.draftId,
      expectedRevision: expectedRevision as number,
      document: body.document,
      clientId: normalizeRealtimeClientId(body.clientId) ?? null,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
