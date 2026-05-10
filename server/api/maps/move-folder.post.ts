/**
 * POST /api/maps/move-folder
 *
 * Renames or relocates a folder under ``data/maps/``.
 *
 * Request body: `{ from: string, to: string, clientId?: string }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { moveMapFolderUseCase, MoveMapFolderUseCaseError } from '../../useCases/moveMapFolder'

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
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return {
      ok: true as const,
      moved: result.moved,
    }
  } catch (err) {
    if (err instanceof MoveMapFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
