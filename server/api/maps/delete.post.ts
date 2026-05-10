/**
 * POST /api/maps/delete
 *
 * Removes a map file. Empty parent directories are pruned.
 *
 * Request body: `{ slug: string, clientId?: string }`
 * Response:     `{ ok: true, path: string }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { deleteMapUseCase, DeleteMapUseCaseError } from '../../useCases/deleteMap'

interface DeleteBody {
  slug?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<DeleteBody | null>(event)

  try {
    const result = deleteMapUseCase({
      slug: body?.slug,
      clientId: typeof body?.clientId === 'string' ? body.clientId : undefined,
    })
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return {
      ok: true as const,
      path: result.path,
    }
  } catch (err) {
    if (err instanceof DeleteMapUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
