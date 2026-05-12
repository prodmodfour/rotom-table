import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  expectRecord,
  expectSheetKind,
  expectSlug,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { saveSheetUseCase } from '../../useCases/saveSheet'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface SaveBody {
  kind?: unknown
  slug?: unknown
  sheet?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireNonProduction()

  const body = await readObjectBody<SaveBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const sheet = expectRecord(body.sheet, 'sheet')

  try {
    const result = saveSheetUseCase({
      role,
      kind,
      slug,
      sheet,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
