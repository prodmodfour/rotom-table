import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents } from '../../utils/useCaseHttp'
import { expectFolderPath, expectSheetKind, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { createSheetUseCase } from '../../useCases/createSheet'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface CreateSheetBody {
  kind?: unknown
  folder?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<CreateSheetBody>(event)
  const kind = expectSheetKind(body.kind)
  const folder = expectFolderPath(body.folder ?? '', { allowEmpty: true })
  const result = createSheetUseCase({
    kind,
    folder,
    clientId: normalizeRealtimeClientId(body.clientId),
  })

  publishUseCaseRealtimeEvents(result.events)

  return {
    ok: result.ok,
    kind: result.kind,
    slug: result.slug,
    path: result.path,
  }
})
