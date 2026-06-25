import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { advanceCampaignDayUseCase } from '../../useCases/advanceCampaignDay'

interface NextDayBody {
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<NextDayBody>(event)

  try {
    const result = advanceCampaignDayUseCase({
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    const { realtimeEvents: _realtimeEvents, paths: _paths, ...payload } = result
    return payload
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
