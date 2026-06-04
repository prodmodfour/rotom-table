/**
 * POST /api/maps/delete
 *
 * Removes a map file. Empty parent directories are pruned.
 *
 * Request body: `{ slug: string, clientId?: string }`
 * Response:     `{ ok: true, path: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { deleteMapUseCase } from '../../useCases/deleteMap'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface DeleteBody {
  slug?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readBody<DeleteBody | null>(event)

  try {
    const result = deleteMapUseCase({
      slug: body?.slug,
      clientId: normalizeRealtimeClientId(body?.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: true as const,
      path: result.path,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
