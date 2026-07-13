import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import {
  applyGmMoveCorrectionUseCase,
  type GmMoveCorrectionResponse,
} from '../../../useCases/applyGmMoveCorrection'

const routeResponse = (response: GmMoveCorrectionResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.sheetUpdates === undefined ? {} : { sheetUpdates: response.sheetUpdates }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireGm(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)

  try {
    const { clientId: rawClientId, ...command } = body
    return routeResponse(applyGmMoveCorrectionUseCase({
      role,
      command,
      clientId: normalizeRealtimeClientId(rawClientId),
    }))
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
