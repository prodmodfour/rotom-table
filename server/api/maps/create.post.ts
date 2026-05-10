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
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { createMapUseCase, CreateMapUseCaseError } from '../../useCases/createMap'
import type { GridDimensions } from '~/types/map'

interface CreateBody {
  name?: unknown
  folder?: unknown
  dimensions?: GridDimensions
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<CreateBody | null>(event)

  try {
    const result = createMapUseCase(body ?? {})
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { map: result.map }
  } catch (err) {
    if (err instanceof CreateMapUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
