import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadLiveTableSnapshotUseCase } from '../../useCases/loadLiveTableSnapshot'
import { normalizeLoadMapSlug } from '../../useCases/loadMap'
import { requireAuthRole } from '../../utils/auth'
import { getPlayerSessionAccessGrant } from '../../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    const query = getQuery(event)
    const slug = normalizeLoadMapSlug(query.slug)
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    const sessionAccess = role === 'player'
      ? getPlayerSessionAccessGrant(event)
      : null

    return loadLiveTableSnapshotUseCase({
      role,
      slug,
      playerProfile,
      sessionAccess,
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
