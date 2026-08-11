import { defineEventHandler } from 'h3'
import { parseBreedingHatchWorkflowRequestV1 } from '#shared/breeding/hatchWorkflow'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  ManageBreedingHatchWorkflowError,
  manageBreedingHatchWorkflow,
} from '../../useCases/manageBreedingHatchWorkflow'
import { readBreedingJsonRequestBody } from '../../security/breedingRequestBody'
import { enforceBreedingWriteRateLimit } from '../../security/breedingWriteRateLimit'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseBreedingHatchWorkflowRequestV1(body) }
    catch { throw new ManageBreedingHatchWorkflowError(400, 'Hatch workflow request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    if (request.intent !== 'inspect' && (role === 'gm' || playerProfile !== null)) {
      enforceBreedingWriteRateLimit(event, { role, profileId: playerProfile?.id ?? null })
    }
    return manageBreedingHatchWorkflow({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
