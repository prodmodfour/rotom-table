/**
 * POST /api/maps/delete-folder
 *
 * Recursively removes a folder under ``data/maps/`` and every map
 * inside it. Empty parents are pruned.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { deleteMapFolderUseCase, DeleteMapFolderUseCaseError } from '../../useCases/deleteMapFolder'

interface DeleteFolderBody {
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<DeleteFolderBody | null>(event)

  try {
    const result = deleteMapFolderUseCase({
      folder: body?.folder,
      clientId: body?.clientId,
    })
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return {
      ok: true as const,
      removed: result.removed,
    }
  } catch (err) {
    if (err instanceof DeleteMapFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
