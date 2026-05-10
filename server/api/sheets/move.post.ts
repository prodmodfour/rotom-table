import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  expectFolderPath,
  expectSheetKind,
  expectSlug,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { moveSheetUseCase } from '../../useCases/moveSheet'
import { normalizeRealtimeClientId } from '~/shared/realtime'

interface MoveSheetBody {
  kind?: unknown
  slug?: unknown
  folder?: unknown
  clientId?: unknown
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
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, moved: result.moved, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
