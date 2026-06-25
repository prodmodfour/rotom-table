import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { deleteSheetFolderUseCase } from '../../useCases/deleteSheetFolder'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface DeleteFolderBody {
  folder?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<DeleteFolderBody>(event)

  try {
    const result = deleteSheetFolderUseCase({
      folder: body.folder,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    return { ok: result.ok, count: result.count, removed: result.removed }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
