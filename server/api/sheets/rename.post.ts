import { createError, defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import {
  expectSheetKind,
  expectSlug,
  expectString,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { publishRealtime } from '../../utils/realtime'
import { RenameSheetUseCaseError, renameSheetUseCase } from '../../useCases/renameSheet'

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
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { ok: result.ok, name: result.name, path: result.path }
  } catch (err) {
    if (err instanceof RenameSheetUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
