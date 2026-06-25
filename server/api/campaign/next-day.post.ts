import { defineEventHandler } from 'h3'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { isSlug } from '#shared/paths'
import { isSheetKind } from '#shared/sheets'
import { requireGm } from '../../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { advanceCampaignDayUseCase } from '../../useCases/advanceCampaignDay'

interface NextDayBody {
  clientId?: unknown
}

const sheetAccessForEvent = (event: { readonly data?: unknown }) => {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {}
  if (!isSheetKind(data.kind) || !isSlug(data.slug)) {
    throw new Error('campaign-day sheet realtime event is missing an explicit sheet identity')
  }
  return { kind: 'sheet-access' as const, sheetKind: data.kind, sheetSlug: data.slug }
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<NextDayBody>(event)

  try {
    const result = advanceCampaignDayUseCase({
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events.map((event) => ({
      event,
      access: sheetAccessForEvent(event),
    })))
    const { events: _events, paths: _paths, ...payload } = result
    return payload
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
