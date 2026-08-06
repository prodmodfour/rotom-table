import { defineEventHandler, readBody } from 'h3'
import { parseBreedingProjectWizardRequestV1 } from '#shared/breeding/projectWizard'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import {
  LoadBreedingProjectWizardError,
  loadBreedingProjectWizard,
} from '../../../useCases/loadBreedingProjectWizard'
import { requireAuthRole } from '../../../utils/auth'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    let request
    try { request = parseBreedingProjectWizardRequestV1(await readBody(event)) }
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
