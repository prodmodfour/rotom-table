import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectSheetKind, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { deleteSheetUseCase } from '../../useCases/deleteSheet'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface DeleteBody {
  kind?: unknown
  slug?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<DeleteBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)

  try {
    const result = deleteSheetUseCase({
      kind,
      slug,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
