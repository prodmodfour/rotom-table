import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { createSheetFolderUseCase } from '../../useCases/createSheetFolder'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface CreateFolderBody {
  folder?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<CreateFolderBody>(event)

  try {
    const result = createSheetFolderUseCase({
      folder: body.folder,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    return { ok: result.ok, created: result.created, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
