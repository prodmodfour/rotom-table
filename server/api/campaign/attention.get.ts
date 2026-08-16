import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadCampaignAttentionUseCase } from '../../useCases/loadCampaignAttention'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return loadCampaignAttentionUseCase({ role, playerProfile })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
