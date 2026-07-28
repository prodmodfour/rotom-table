import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { beginAbilityDeclarationUseCase } from '../../../useCases/beginAbilityDeclaration'
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
    const offer = beginAbilityDeclarationUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
      command: body.command,
    })
    emitAbilityAutomationObservation({
      event: 'declaration-offered',
      durationMs: Date.now() - startedAt,
      declarationCount: offer.declarations.length,
      optionCount: offer.declarations.reduce((count, declaration) => count + declaration.options.length, 0),
    })
    return offer
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
