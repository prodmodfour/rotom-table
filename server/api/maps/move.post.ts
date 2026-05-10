/**
 * POST /api/maps/move
 *
 * Moves a map file into a different folder under ``data/maps/``.
 * Empty `folder` moves the map back to the root.
 *
 * Request body: `{ slug: string, folder: string, clientId?: string }`
 * Response:     `{ ok: true, moved: boolean, path: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { moveMapUseCase } from '../../useCases/moveMap'

interface MoveBody {
  slug?: unknown
  folder?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<MoveBody | null>(event)

  try {
    const result = moveMapUseCase({
      slug: body?.slug,
      folder: body?.folder,
      clientId: typeof body?.clientId === 'string' ? body.clientId : undefined,
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: true as const,
      moved: result.moved,
      path: result.path,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
