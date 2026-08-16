import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadGroupInventoryItemActionsUseCase } from '../../useCases/loadGroupInventoryItemActions'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, expectSlug } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  const allowed = new Set(['groupSlug', 'actorSelectionId', 'profileId'])
  if (Object.keys(query).some(key => !allowed.has(key))) {
    badRequest('Shared item actions accept only groupSlug, actorSelectionId, and profileId.')
  }
  if (query.actorSelectionId !== undefined && typeof query.actorSelectionId !== 'string') {
    badRequest('actorSelectionId must be a string when provided.')
  }
  try {
    return loadGroupInventoryItemActionsUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null,
      groupSlug: expectSlug(query.groupSlug, 'groupSlug'),
      actorSelectionId: query.actorSelectionId,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
