import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireNonProduction } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { advanceCampaignDayUseCase } from '../../useCases/advanceCampaignDay'

interface NextDayBody {
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<NextDayBody>(event)

  try {
    const result = advanceCampaignDayUseCase({
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    const { events: _events, paths: _paths, ...payload } = result
    return payload
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
