/**
 * POST /api/maps/rename
 *
 * Updates a map's display name. If the new name slugifies to a
 * different slug, the SQLite row and map document slug are renamed;
 * otherwise only the name changes.
 *
 * When the slug changes, a `renamed` event is broadcast on both the
 * old `map:<slug>` channel and the `maps` channel so other tabs /
 * open editors can swap their cached entry / navigate to the new URL.
 *
 * Request body: `{ slug: string, name: string, clientId?: string }`
 * Response:     `{ ok: true, slug: string, name: string, path: string }`
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { renameMapUseCase } from '../../useCases/renameMap'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface RenameBody {
  slug?: unknown
  name?: unknown
  clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readBody<RenameBody | null>(event)

  try {
    const result = renameMapUseCase({
      slug: body?.slug,
      name: body?.name,
      clientId: normalizeRealtimeClientId(body?.clientId),
    })
    return {
      ok: true as const,
      slug: result.slug,
      name: result.name,
      path: result.path,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
