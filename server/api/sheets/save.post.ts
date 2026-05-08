import { defineEventHandler } from 'h3'
import { sheetChannel, sheetsChannel } from '~/shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import {
  badRequest,
  expectRecord,
  expectSheetKind,
  expectSlug,
  forbidden,
  notFound,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import {
  findPersistedSheetFile,
  sheetIsPlayerAccessible,
  stripDerivedSheetFields,
  writeSheetFile,
} from '../../utils/sheetStorage'
import { publishRealtime } from '../../utils/realtime'
import { relativeToProjectRoot } from '../../utils/fsPaths'

interface SaveBody {
  kind?: unknown
  slug?: unknown
  sheet?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireNonProduction()

  const body = await readObjectBody<SaveBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const sheet = expectRecord(body.sheet, 'sheet')

  const payloadSlug = String(sheet.slug ?? '')
  if (payloadSlug !== slug) {
    badRequest(`sheet.slug "${payloadSlug}" must match request slug "${slug}"`)
  }

  const path = findPersistedSheetFile(kind, slug) ?? notFound(`Sheet ${slug}.json not found`)

  if (role === 'player' && !sheetIsPlayerAccessible(kind, slug)) {
    forbidden('Sheet is not marked as player accessible')
  }

  const out: Record<string, unknown> = stripDerivedSheetFields(sheet)
  if (role === 'player') out.player = true
  writeSheetFile(path, out)

  const data = { kind, slug, sheet: out }
  const clientId = typeof body.clientId === 'string' ? body.clientId : undefined
  publishRealtime({ channel: sheetChannel(kind, slug), type: 'updated', clientId, data })
  publishRealtime({ channel: sheetsChannel, type: 'updated', clientId, data })

  return {
    ok: true as const,
    path: relativeToProjectRoot(path),
  }
})
