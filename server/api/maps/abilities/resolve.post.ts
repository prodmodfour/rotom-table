import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { resolveAbilityDeclarationForControllerUseCase } from '../../../useCases/resolveAbilityDeclaration'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import {
  abilityAutomationObservationReasonForError,
  emitAbilityAutomationObservation,
} from '../../../utils/abilityAutomationObservability'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const startedAt = Date.now()
  try {
    const envelope = resolveAbilityDeclarationForControllerUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
      intent: body.intent,
    })
    emitAbilityAutomationObservation({
      event: envelope.result.kind === 'pending' ? 'resolution-pending' : 'resolution-committed',
      durationMs: Date.now() - startedAt,
      outstandingWindowCount: envelope.result.kind === 'pending'
        ? envelope.result.outstandingWindowCount
        : 0,
    })
    return envelope
  }
  catch (error) {
    emitAbilityAutomationObservation({
      event: 'request-rejected',
      reasonFamily: abilityAutomationObservationReasonForError(error),
      durationMs: Date.now() - startedAt,
    })
    throwUseCaseHttpError(error)
  }
})
