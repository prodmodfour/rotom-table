import { defineEventHandler } from 'h3'
import { parseBreedingConsentWorkflowRequestV1 } from '#shared/breeding/consentWorkflow'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  ManageBreedingConsentWorkflowError,
  manageBreedingConsentWorkflow,
} from '../../useCases/manageBreedingConsentWorkflow'
import { readBreedingJsonRequestBody } from '../../security/breedingRequestBody'
import { enforceBreedingWriteRateLimit } from '../../security/breedingWriteRateLimit'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseBreedingConsentWorkflowRequestV1(body) }
    catch { throw new ManageBreedingConsentWorkflowError(400, 'Breeding consent workflow request is malformed') }
    if ((role === 'player' && request.profileId === null) || (role === 'gm' && request.profileId !== null)) {
      throw new ManageBreedingConsentWorkflowError(400, 'Consent workflow Profile context is contradictory')
    }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    if (request.intent !== 'view' && (role === 'gm' || playerProfile !== null)) {
      enforceBreedingWriteRateLimit(event, { role, profileId: playerProfile?.id ?? null })
    }
    return manageBreedingConsentWorkflow({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
