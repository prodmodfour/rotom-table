import { defineEventHandler, readBody } from 'h3'
import { parseBreedingHatchWorkflowRequestV1 } from '#shared/breeding/hatchWorkflow'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import {
  ManageBreedingHatchWorkflowError,
  manageBreedingHatchWorkflow,
} from '../../useCases/manageBreedingHatchWorkflow'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    let request
    try { request = parseBreedingHatchWorkflowRequestV1(await readBody(event)) }
    catch { throw new ManageBreedingHatchWorkflowError(400, 'Hatch workflow request is malformed') }
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(request.profileId)
      : null
    return manageBreedingHatchWorkflow({ role, playerProfile, request })
  }
  catch (error) { throwUseCaseHttpError(error) }
})
