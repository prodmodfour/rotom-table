import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import {
  expectFolderPath,
  expectSheetKind,
  expectSlug,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { publishRealtime } from '../../utils/realtime'
import { MoveSheetUseCaseError, moveSheetUseCase } from '../../useCases/moveSheet'

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

  try {
    const result = moveSheetUseCase({
      kind,
      slug,
      folder,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { ok: result.ok, moved: result.moved, path: result.path }
  } catch (err) {
    if (err instanceof MoveSheetUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
