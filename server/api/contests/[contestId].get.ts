import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadContestUseCase } from '../../useCases/contests'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    return { ok: true, contest: loadContestUseCase(decodeURIComponent(getRouterParam(event, 'contestId') ?? ''), { role, playerProfile, diagnostic: role === 'gm' && query.diagnostic === '1' }) }
  } catch (error) { throwUseCaseHttpError(error) }
})
