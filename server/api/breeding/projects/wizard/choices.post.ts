import { defineEventHandler, readBody } from 'h3'
import { parseBreedingProjectChoicesRequestV1 } from '#shared/breeding/projectChoices'
import { resolvePlayerProfileForPolicy } from '../../../../policies/playerProfilePolicy'
import {
  LoadBreedingProjectChoicesError,
  loadBreedingProjectChoices,
} from '../../../../useCases/loadBreedingProjectChoices'
import { requireAuthRole } from '../../../../utils/auth'
import { throwUseCaseHttpError } from '../../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    let request
    try { request = parseBreedingProjectChoicesRequestV1(await readBody(event)) }
    catch { throw new LoadBreedingProjectChoicesError(400, 'Breeding Project choice request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    return loadBreedingProjectChoices({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
