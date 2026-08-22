import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { listContestsUseCase } from '../../useCases/contests'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    return { ok: true, contests: listContestsUseCase({ role, playerProfile }) }
  } catch (error) { throwUseCaseHttpError(error) }
})
