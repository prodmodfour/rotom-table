/**
 * POST /api/maps/delete-folder
 *
 * Recursively removes a logical SQLite map folder and every map
 * inside it.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { deleteMapFolderUseCase } from '../../useCases/deleteMapFolder'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface DeleteFolderBody {
  folder?: string
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readBody<DeleteFolderBody | null>(event)

  try {
    const result = deleteMapFolderUseCase({
      folder: body?.folder,
      clientId: normalizeRealtimeClientId(body?.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: true as const,
      removed: result.removed,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
