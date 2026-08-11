import { defineEventHandler } from 'h3'
import { parseBreedingProjectChoicesRequestV1 } from '#shared/breeding/projectChoices'
import { resolvePlayerProfileForPolicy } from '../../../../policies/playerProfilePolicy'
import {
  LoadBreedingProjectChoicesError,
  loadBreedingProjectChoices,
} from '../../../../useCases/loadBreedingProjectChoices'
import { readBreedingJsonRequestBody } from '../../../../security/breedingRequestBody'
import { enforceBreedingWriteRateLimit } from '../../../../security/breedingWriteRateLimit'
import { requireAuthRole } from '../../../../utils/auth'
import { throwUseCaseHttpError } from '../../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseBreedingProjectChoicesRequestV1(body) }
    catch { throw new LoadBreedingProjectChoicesError(400, 'Breeding Project choice request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    if (request.confirmed && (role === 'gm' || playerProfile !== null)) {
      enforceBreedingWriteRateLimit(event, { role, profileId: playerProfile?.id ?? null })
    }
    return loadBreedingProjectChoices({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
