import { createError, defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import {
  expectRecord,
  expectSheetKind,
  expectSlug,
  readObjectBody,
  requireNonProduction,
} from '../../utils/http'
import { publishRealtime } from '../../utils/realtime'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../useCases/saveSheet'

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

  try {
    const result = saveSheetUseCase({
      role,
      kind,
      slug,
      sheet,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { ok: result.ok, path: result.path }
  } catch (err) {
    if (err instanceof SaveSheetUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
