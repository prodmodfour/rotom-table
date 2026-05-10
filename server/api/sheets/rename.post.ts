import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  expectSheetKind,
  expectSlug,
  expectString,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { renameSheetUseCase } from '../../useCases/renameSheet'

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

  try {
    const result = renameSheetUseCase({
      kind,
      slug,
      name,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, name: result.name, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
