/**
 * POST /api/maps/create-folder
 *
 * Creates an empty folder under ``data/maps/`` so it's visible in the
 * browser before any map lives in it.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { createMapFolderUseCase, CreateMapFolderUseCaseError } from '../../useCases/createMapFolder'

interface CreateFolderBody {
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<CreateFolderBody | null>(event)

  try {
    const result = createMapFolderUseCase({
      folder: body?.folder,
      clientId: body?.clientId,
    })
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return {
      ok: true as const,
      created: result.created,
      path: result.path,
    }
  } catch (err) {
    if (err instanceof CreateMapFolderUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
