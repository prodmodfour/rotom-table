import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { badRequest, expectRecord, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { saveMapUseCase } from '../../useCases/saveMap'
import { parseMapInteractionMode } from '#shared/mapInteractionMode'
import { normalizeRealtimeClientId } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: unknown
  map?: unknown
  clientId?: unknown
  interactionMode?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SaveBody>(event)
  const slug = expectSlug(body.slug)
  const map = expectRecord(body.map, 'map') as unknown as TabletopMap
  const interactionMode = parseMapInteractionMode(body.interactionMode)
    ?? badRequest('interactionMode must be "setup-edit" or "live-play"')

  try {
    const result = saveMapUseCase({
      role,
      slug,
      map,
      clientId: normalizeRealtimeClientId(body.clientId),
      interactionMode,
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: true as const, path: result.path, map: result.map }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
