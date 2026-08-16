import { createError, defineEventHandler, getHeader, getQuery } from 'h3'
import { parseItemBreedingWorkflowPostRequest } from '#shared/breeding/itemWorkflows'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { readBreedingJsonRequestBody } from '../../security/breedingRequestBody'
import { enforceBreedingWriteRateLimit } from '../../security/breedingWriteRateLimit'
import { handleItemBreedingPost } from '../../useCases/manageItemBreedingWorkflows'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  try {
    const query = getQuery(event)
    const allowed = role === 'player' ? new Set(['profileId']) : new Set<string>()
    if (Object.keys(query).some(field => !allowed.has(field))) {
      throw createError({ statusCode: 400, statusMessage: 'Breeding item workflow request query is malformed.' })
    }
    const playerProfile = role === 'player' ? resolvePlayerProfileForPolicy(query.profileId) : null
    const body = await readBreedingJsonRequestBody(event)
    let request
    try { request = parseItemBreedingWorkflowPostRequest(body) }
    catch { throw createError({ statusCode: 400, statusMessage: 'Invalid item breeding request.' }) }
    if (!('action' in request)) {
      enforceBreedingWriteRateLimit(event, { role, profileId: playerProfile?.id ?? null })
    }
    const rawClientId = getHeader(event, 'x-rotom-client-id')
    const clientId = typeof rawClientId === 'string' && rawClientId.length <= 160 ? rawClientId : undefined
    return handleItemBreedingPost({
      authority: { role, playerProfile, ...(clientId ? { clientId } : {}) },
      request,
    })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
