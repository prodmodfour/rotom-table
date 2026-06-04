/**
 * POST /api/maps/create-folder
 *
 * Creates an empty folder under ``data/maps/`` so it's visible in the
 * browser before any map lives in it.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { createMapFolderUseCase } from '../../useCases/createMapFolder'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface CreateFolderBody {
  folder?: string
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readBody<CreateFolderBody | null>(event)

  try {
    const result = createMapFolderUseCase({
      folder: body?.folder,
      clientId: normalizeRealtimeClientId(body?.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: true as const,
      created: result.created,
      path: result.path,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
