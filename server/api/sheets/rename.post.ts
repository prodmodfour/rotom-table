import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  expectSheetKind,
  expectSlug,
  expectString,
  readObjectBody,
  requireWritableCampaignMode,
} from '../../utils/http'
import { renameSheetUseCase } from '../../useCases/renameSheet'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface RenameBody {
  kind?: unknown
  slug?: unknown
  name?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<RenameBody>(event)
  const kind = expectSheetKind(body.kind)
  const slug = expectSlug(body.slug)
  const name = expectString(body.name, 'name', { maxLength: 80 })

  try {
    const result = renameSheetUseCase({
      kind,
      slug,
      name,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: result.ok, slug: result.slug, name: result.name, path: result.path }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
