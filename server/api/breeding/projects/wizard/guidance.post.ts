import { defineEventHandler } from 'h3'
import { parseBreedingProjectWizardRequestV1 } from '#shared/breeding/projectWizard'
import { resolvePlayerProfileForPolicy } from '../../../../policies/playerProfilePolicy'
import { readBreedingJsonRequestBody } from '../../../../security/breedingRequestBody'
import {
  LoadBreedingProjectGuidanceError,
  loadBreedingProjectGuidance,
} from '../../../../useCases/loadBreedingProjectGuidance'
import { requireAuthRole } from '../../../../utils/auth'
import { throwUseCaseHttpError } from '../../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseBreedingProjectWizardRequestV1(body) }
    catch { throw new LoadBreedingProjectGuidanceError(400, 'Breeding Project guidance request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    return loadBreedingProjectGuidance({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
