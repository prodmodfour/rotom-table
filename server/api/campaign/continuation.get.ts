import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadCampaignContinuationUseCase } from '../../useCases/loadCampaignContinuation'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    if (Object.keys(query).some(key => key !== 'profileId')) {
      badRequest('Campaign continuation accepts only profileId.')
    }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return loadCampaignContinuationUseCase({ role, playerProfile })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
