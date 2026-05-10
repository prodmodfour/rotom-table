import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectFolderPath, expectSheetKind, readObjectBody, requireNonProduction } from '../../utils/http'
import { publishRealtime } from '../../utils/realtime'
import { createSheetUseCase } from '../../useCases/createSheet'

interface CreateSheetBody {
  kind?: unknown
  folder?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<CreateSheetBody>(event)
  const kind = expectSheetKind(body.kind)
  const folder = expectFolderPath(body.folder ?? '', { allowEmpty: true })
  const result = createSheetUseCase({
    kind,
    folder,
    clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
  })

  for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)

  return {
    ok: result.ok,
    kind: result.kind,
    slug: result.slug,
    path: result.path,
  }
})
