import { defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  LoadBreedingWorkshopError,
  loadBreedingWorkshop,
} from '../../useCases/loadBreedingWorkshop'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const allowedFields = role === 'player'
      ? new Set(['profileId', 'trainerSheetSlug', 'ownershipCursor'])
      : new Set(['trainerSheetSlug', 'ownershipCursor'])
    if (Object.keys(query).some(field => !allowedFields.has(field))) {
      throw new LoadBreedingWorkshopError(400, 'Breeding Workshop query is malformed')
    }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(query.profileId)
      : null
    return loadBreedingWorkshop({
      role,
      playerProfile,
      query: {
        trainerSheetSlug: query.trainerSheetSlug ?? null,
        ownershipCursor: query.ownershipCursor ?? null,
      },
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
