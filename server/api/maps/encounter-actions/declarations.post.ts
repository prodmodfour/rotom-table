import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { declareEncounterActionUseCase } from '../../../useCases/declareEncounterAction'
import { requireAuthRole } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  try {
    return declareEncounterActionUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
      intent: body.intent,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
