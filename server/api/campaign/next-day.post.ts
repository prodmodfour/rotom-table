import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import { badRequest, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { advanceCampaignDayAfterPreflightUseCase } from '../../useCases/advanceCampaignDayAfterPreflight'

interface NextDayBody {
  schemaVersion?: unknown
  operationId?: unknown
  kind?: unknown
  days?: unknown
  preflightId?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<NextDayBody>(event)
  const allowed = new Set(['schemaVersion', 'operationId', 'kind', 'days', 'preflightId', 'clientId'])
  if (Object.keys(body).some(key => !allowed.has(key))
    || !Object.hasOwn(body, 'schemaVersion')
    || !Object.hasOwn(body, 'operationId')
    || !Object.hasOwn(body, 'kind')
    || !Object.hasOwn(body, 'days')) {
    badRequest('Campaign next-day request must contain exactly one v1 command and only optional preflightId and clientId.')
  }
  if (body.clientId !== undefined && typeof body.clientId !== 'string') {
    badRequest('Campaign next-day clientId must be a string when provided.')
  }

  try {
    const { result } = advanceCampaignDayAfterPreflightUseCase({
      clientId: normalizeRealtimeClientId(body.clientId),
      preflightId: body.preflightId,
      command: {
        schemaVersion: body.schemaVersion,
        operationId: body.operationId,
        kind: body.kind,
        days: body.days,
      },
    })
    const { realtimeEvents: _realtimeEvents, paths: _paths, ...payload } = result
    return payload
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
