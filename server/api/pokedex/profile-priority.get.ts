import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { listProfilePokedexPriorityUseCase } from '../../useCases/listProfilePokedexPriority'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    const profile = resolvePlayerProfileForPolicy(getQuery(event).profileId)
    return profile
      ? listProfilePokedexPriorityUseCase({ role, profile })
      : { slugs: [] }
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
