import { defineEventHandler } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { executeItemExplorationOperationUseCase } from '../../useCases/executeItemExplorationOperation'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)
  const allowedFields = new Set(['command', 'profileId', 'clientId'])
  if (Object.keys(body).some(key => !allowedFields.has(key)) || !Object.hasOwn(body, 'command')) {
    badRequest('Item exploration request must contain only command, profileId, and clientId.')
  }
  if (body.profileId !== undefined && typeof body.profileId !== 'string') badRequest('profileId must be a string when provided.')
  if (body.clientId !== undefined && typeof body.clientId !== 'string') badRequest('clientId must be a string when provided.')
  try {
    return {
      result: executeItemExplorationOperationUseCase({
        role,
        playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(body.profileId) : null,
        command: body.command,
        clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
      }),
    }
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
