import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadSheetItemActionsUseCase } from '../../useCases/loadSheetItemActions'
import { requireAuthRole } from '../../utils/auth'
import { expectSlug } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const query = getQuery(event)
  try {
    return loadSheetItemActionsUseCase({
      role,
      playerProfile: role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null,
      trainerSlug: expectSlug(query.trainerSlug, 'trainerSlug'),
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
