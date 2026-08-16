import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadItemGuidedAdjudicationUseCase } from '../../useCases/manageItemGuidedAdjudication'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, expectSlug } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  const hasOwner = query.ownerKind !== undefined || query.ownerSlug !== undefined
  if (hasOwner && (query.ownerKind === undefined || query.ownerSlug === undefined)) {
    badRequest('Guided item ownerKind and ownerSlug must be provided together.')
  }
  if (query.ownerKind !== undefined && query.ownerKind !== 'trainer' && query.ownerKind !== 'pokemon') {
    badRequest('Guided item ownerKind must be trainer or pokemon.')
  }
  if (role === 'player' && !hasOwner) badRequest('Player guided item projection requires one controlled owner.')
  try {
    return loadItemGuidedAdjudicationUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null,
      ownerKind: query.ownerKind as 'trainer' | 'pokemon' | undefined,
      ownerSlug: query.ownerSlug === undefined ? undefined : expectSlug(query.ownerSlug, 'ownerSlug'),
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
