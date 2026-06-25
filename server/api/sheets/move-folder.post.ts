import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { moveSheetFolderUseCase } from '../../useCases/moveSheetFolder'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface MoveFolderBody {
  from?: unknown
  to?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<MoveFolderBody>(event)

  try {
    const result = moveSheetFolderUseCase({
      from: body.from,
      to: body.to,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    return { ok: result.ok, moved: result.moved, count: result.count }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
