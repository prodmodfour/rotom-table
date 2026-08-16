import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadEncounterSettlement } from '../../useCases/loadEncounterSettlement'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    const allowed = new Set(['profileId', 'expectedRevision', 'historyLimit'])
    if (Object.keys(query).some(key => !allowed.has(key))) {
      badRequest('Settlement load accepts only profileId, expectedRevision, and historyLimit.')
    }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return loadEncounterSettlement({
      role,
      playerProfile,
      settlementId: getRouterParam(event, 'settlementId'),
      expectedRevision: query.expectedRevision,
      historyLimit: query.historyLimit,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
