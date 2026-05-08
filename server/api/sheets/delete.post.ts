import { defineEventHandler } from 'h3'
import { sheetChannel, sheetsChannel } from '~/shared/realtime'
import { requireGm } from '../../utils/auth'
import { expectSheetKind, expectSlug, notFound, readObjectBody, requireNonProduction } from '../../utils/http'
import { deleteSheetFile } from '../../utils/sheetStorage'
import { publishRealtime } from '../../utils/realtime'

interface DeleteBody {
  kind?: unknown
  slug?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<DeleteBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const result = deleteSheetFile(kind, slug) ?? notFound(`Sheet ${slug}.json not found`)

  const data = { kind, slug }
  const clientId = typeof body.clientId === 'string' ? body.clientId : undefined
  publishRealtime({ channel: sheetChannel(kind, slug), type: 'deleted', clientId, data })
  publishRealtime({ channel: sheetsChannel, type: 'deleted', clientId, data })

  return { ok: true as const, path: result.relativePath }
})
