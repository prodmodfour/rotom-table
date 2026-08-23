import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  loadCampaignSkillCheckHistoryUseCase,
  type CampaignSkillCheckHistoryAuthority,
} from '../../useCases/loadCampaignSkillCheckHistory'
import { requireAuthRole } from '../../utils/auth'
import { badRequest } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'profileId' && key !== 'limit')) {
    badRequest('Campaign Skill Check history accepts only profileId and limit.')
  }
  const limit = query.limit === undefined ? undefined : Number(query.limit)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)) {
    badRequest('Campaign Skill Check history limit must be an integer from 1 through 20.')
  }
  let authority: CampaignSkillCheckHistoryAuthority
  if (role === 'gm') {
    if (query.profileId !== undefined) badRequest('GM campaign Skill Check history does not accept profileId.')
    authority = { kind: 'gm' }
  }
  else {
    if (query.profileId === undefined || query.profileId === '') {
      badRequest('Player campaign Skill Check history requires a selected Profile.')
    }
    const profile = resolvePlayerProfileForPolicy(query.profileId)
      ?? badRequest('The selected campaign Skill Check Profile is unavailable.')
    authority = { kind: 'owner', profile }
  }
  try {
    return loadCampaignSkillCheckHistoryUseCase({ authority, limit })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
