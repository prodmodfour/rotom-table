import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { listPendingMoveResponsesUseCase } from '../../../useCases/listPendingMoveResponses'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    const query = getQuery(event)
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return listPendingMoveResponsesUseCase({
      role,
      mapSlug: query.slug,
      playerProfile,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
