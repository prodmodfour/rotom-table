/**
 * POST /api/maps/create
 *
 * Creates a new empty map. Slug is auto-allocated from the supplied
 * name (or a default), with numeric suffixes if the base slug is
 * taken. Default dimensions match `DEFAULT_GRID_DIMENSIONS` in the
 * client utils so the editor renders something sensible immediately.
 *
 * Request body (all optional):
 *   { name?: string, folder?: string, dimensions?: GridDimensions, clientId?: string }
 *
 * Response: `{ map: TabletopMap }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createMapUseCase } from '../../useCases/createMap'
import { normalizeRealtimeClientId } from '#shared/realtime'
import type { GridDimensions } from '~/types/map'

interface CreateBody {
  name?: unknown
  folder?: unknown
  dimensions?: GridDimensions
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<CreateBody | null>(event)

  try {
    const result = createMapUseCase({
      ...(body ?? {}),
      clientId: normalizeRealtimeClientId(body?.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return { map: result.map }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
