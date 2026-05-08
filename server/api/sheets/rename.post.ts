import { createError, defineEventHandler } from 'h3'
import { sheetChannel, sheetsChannel } from '~/shared/realtime'
import { requireGm } from '../../utils/auth'
import {
  expectSheetKind,
  expectSlug,
  expectString,
  notFound,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { renameSheetFile } from '../../utils/sheetStorage'
import { publishRealtime } from '../../utils/realtime'

interface RenameBody {
  kind?: unknown
  slug?: unknown
  name?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<RenameBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const name = expectString(body.name, 'name', { maxLength: 80 })

  let result: ReturnType<typeof renameSheetFile>
  try {
    result = renameSheetFile(kind, slug, name)
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: `Failed to parse or write sheet: ${err}` })
  }
  const renamed = result ?? notFound(`Sheet ${slug}.json not found`)

  const data = { kind, slug, sheet: renamed.sheet }
  const clientId = typeof body.clientId === 'string' ? body.clientId : undefined
  publishRealtime({ channel: sheetChannel(kind, slug), type: 'updated', clientId, data })
  publishRealtime({ channel: sheetsChannel, type: 'updated', clientId, data })

  return {
    ok: true as const,
    name,
    path: renamed.relativePath,
  }
})
