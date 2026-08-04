import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadEncounterWorkspaceUseCase } from '../../useCases/loadEncounterWorkspace'
import { requireAuthRole } from '../../utils/auth'
import { requireEncounterWorkspaceFeature } from '../../utils/encounterWorkspaceFeature'
import { getPlayerSessionAccessGrant } from '../../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  requireEncounterWorkspaceFeature(event)
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    return loadEncounterWorkspaceUseCase({
      role,
      slug: query.slug,
      audience: query.audience,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null,
      sessionAccess: role === 'player' ? getPlayerSessionAccessGrant(event) : null,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
