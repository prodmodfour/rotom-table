import { defineEventHandler } from 'h3'
import { sheetsChannel } from '~/shared/realtime'
import { requireGm } from '../../utils/auth'
import { expectFolderPath, expectSheetKind, readObjectBody, requireNonProduction } from '../../utils/http'
import { createSheetFile } from '../../utils/sheetStorage'
import { publishRealtime } from '../../utils/realtime'

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
  const result = createSheetFile(kind, folder)

  publishRealtime({
    channel: sheetsChannel,
    type: 'updated',
    clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    data: { kind, slug: result.slug, sheet: { ...result.sheet, folder } },
  })

  return {
    ok: true as const,
    kind,
    slug: result.slug,
    path: result.relativePath,
  }
})
