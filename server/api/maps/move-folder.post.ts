/**
 * POST /api/maps/move-folder
 *
 * Renames or relocates a folder under ``data/maps/``.
 *
 * Request body: `{ from: string, to: string, clientId?: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { moveMapFolderUseCase } from '../../useCases/moveMapFolder'

interface MoveFolderBody {
  from?: string
  to?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<MoveFolderBody | null>(event)

  try {
    const result = moveMapFolderUseCase({
      from: body?.from,
      to: body?.to,
      clientId: body?.clientId,
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: true as const,
      moved: result.moved,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
