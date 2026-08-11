import { defineEventHandler } from 'h3'
import { parseBreedingProjectWizardRequestV1 } from '#shared/breeding/projectWizard'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { readBreedingJsonRequestBody } from '../../../security/breedingRequestBody'
import {
  LoadBreedingProjectWizardError,
  loadBreedingProjectWizard,
} from '../../../useCases/loadBreedingProjectWizard'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseBreedingProjectWizardRequestV1(body) }
    catch { throw new LoadBreedingProjectWizardError(400, 'Breeding Project wizard request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    return loadBreedingProjectWizard({ role, playerProfile, request })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
