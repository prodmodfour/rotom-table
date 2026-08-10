import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import {
  LoadBreedingWorkshopActivityError,
  loadBreedingWorkshopActivity,
} from '../../../useCases/loadBreedingWorkshopActivity'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const allowed = role === 'player'
      ? new Set(['profileId', 'trainerSheetSlug'])
      : new Set(['trainerSheetSlug'])
    if (Object.keys(query).some(field => !allowed.has(field))) {
      throw new LoadBreedingWorkshopActivityError(400, 'Breeding Workshop activity query is malformed')
    }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return loadBreedingWorkshopActivity({
      role,
      playerProfile,
      request: {
        profileId: role === 'player' ? query.profileId ?? null : null,
        trainerSheetSlug: query.trainerSheetSlug ?? null,
      },
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
