import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { expectSheetKind, expectSlug, readObjectBody, requireNonProduction } from '../../utils/http'
import { publishRealtime } from '../../utils/realtime'
import { DeleteSheetUseCaseError, deleteSheetUseCase } from '../../useCases/deleteSheet'

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
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { ok: result.ok, path: result.path }
  } catch (err) {
    if (err instanceof DeleteSheetUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
