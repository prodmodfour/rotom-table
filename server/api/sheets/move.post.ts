import { defineEventHandler } from 'h3'
import { sheetsChannel } from '~/shared/realtime'
import { requireGm } from '../../utils/auth'
import {
  badRequest,
  conflict,
  expectFolderPath,
  expectSheetKind,
  expectSlug,
  notFound,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { moveSheetFile } from '../../utils/sheetStorage'
import { publishRealtime } from '../../utils/realtime'

interface MoveSheetBody {
  kind?: unknown
  slug?: unknown
  folder?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireNonProduction()

  const body = await readObjectBody<MoveSheetBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const folder = expectFolderPath(body.folder ?? '', { allowEmpty: true })

  let result: ReturnType<typeof moveSheetFile> = null
  try {
    result = moveSheetFile(kind, slug, folder)
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already exists')) conflict(message)
    badRequest(message)
  }

  const moved = result ?? notFound(`Sheet ${slug}.json not found`)

  publishRealtime({
    channel: sheetsChannel,
    type: 'moved',
    clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    data: { kind, slug, folder },
  })

  return {
    ok: true as const,
    moved: moved.moved,
    path: moved.relativePath,
  }
})
