import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadItemExplorationUseCase } from '../../useCases/loadItemExploration'
import { requireAuthRole } from '../../utils/auth'
import { badRequest, expectSlug } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  const trainerSlug = query.trainerSlug
  const mapSlug = query.mapSlug
  if ((trainerSlug === undefined) === (mapSlug === undefined)) {
    badRequest('Item exploration projection requires exactly one trainerSlug or mapSlug.')
  }
  try {
    return trainerSlug !== undefined
      ? loadItemExplorationUseCase({
          kind: 'trainer',
          role,
          playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null,
          trainerSlug: expectSlug(trainerSlug, 'trainerSlug'),
        })
      : loadItemExplorationUseCase({
          kind: 'map',
          role,
          mapSlug: expectSlug(mapSlug, 'mapSlug'),
        })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
