import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadInventoryHistoryUseCase } from '../../useCases/loadInventoryHistory'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const allowed = new Set(['trainerSlug', 'groupSlug', 'profileId', 'limit'])
    if (Object.keys(query).some(key => !allowed.has(key))) {
      badRequest('Inventory history accepts only trainerSlug or groupSlug plus profileId and limit.')
    }
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    return loadInventoryHistoryUseCase({
      role,
      playerProfile,
      trainerSlug: query.trainerSlug,
      groupSlug: query.groupSlug,
      limit: query.limit,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
