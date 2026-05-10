import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectSheetKind, expectSlug, readObjectBody, requireNonProduction } from '../../utils/http'
import { deleteSheetUseCase } from '../../useCases/deleteSheet'

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

  try {
    const result = deleteSheetUseCase({
      kind,
      slug,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
