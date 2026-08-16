import { createError, defineEventHandler, getQuery } from 'h3'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { loadItemBreedingWorkflows } from '../../useCases/manageItemBreedingWorkflows'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const allowed = role === 'player' ? new Set(['profileId','trainerSheetSlug']) : new Set(['trainerSheetSlug'])
    if (Object.keys(query).some(field => !allowed.has(field))
      || typeof query.trainerSheetSlug !== 'string' || Array.isArray(query.trainerSheetSlug)) {
      throw createError({ statusCode: 400, statusMessage: 'Breeding item workflow query is malformed.' })
    }
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    return loadItemBreedingWorkflows({
      authority: { role, playerProfile },
      trainerSheetSlug: query.trainerSheetSlug,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
