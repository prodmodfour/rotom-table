import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { readLivePlayPresenceSnapshot } from '../../../livePlay/presenceAccess'
import { requireAuthRole } from '../../../utils/auth'
import { getPlayerSessionAccessGrant } from '../../../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { setPrivateNoStoreHeaders } from '../../../utils/cacheHeaders'

export default defineEventHandler((event) => {
  setPrivateNoStoreHeaders(event)
  const role = requireAuthRole(event)

  try {
    const query = getQuery(event)
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    const sessionAccess = role === 'player'
      ? getPlayerSessionAccessGrant(event)
      : null

    return readLivePlayPresenceSnapshot({
      slug: getRouterParam(event, 'slug'),
      viewer: {
        role,
        playerProfile,
        sessionAccess,
      },
    })
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
