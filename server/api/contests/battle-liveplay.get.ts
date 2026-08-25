import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadBattleContestLiveplayUseCase } from '../../useCases/battleContestLiveplay'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const forcePublic = query.view === 'public'
    const playerProfile = role === 'player' && !forcePublic ? resolvePlayerProfileForPolicy(query.profileId) : null
    const encounterId = typeof query.encounterId === 'string' ? query.encounterId : ''
    return loadBattleContestLiveplayUseCase(encounterId, { role: forcePublic ? 'player' : role, playerProfile })
  } catch (error) { throwUseCaseHttpError(error) }
})
