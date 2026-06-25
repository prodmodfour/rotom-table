import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { badRequest, expectRecord, expectRevision, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { saveMapUseCase } from '../../useCases/saveMap'
import { parseMapInteractionMode, MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { requireSetupEditMapInteractionMode } from '../../utils/mapInteractionModePolicy'
import { normalizeRealtimeClientId } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: unknown
  map?: unknown
  clientId?: unknown
  interactionMode?: unknown
  expectedRevision?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SaveBody>(event)
  const slug = expectSlug(body.slug)
  const map = expectRecord(body.map, 'map') as unknown as TabletopMap
  const interactionMode = parseMapInteractionMode(body.interactionMode)
    ?? badRequest('interactionMode must be "setup-edit" or "live-play"')
  const expectedRevision = expectRevision(body.expectedRevision, 'expectedRevision')
  if (role === 'gm' && interactionMode === MAP_INTERACTION_MODES.SETUP_EDIT) requireSetupEditMapInteractionMode(slug)

  try {
    const result = saveMapUseCase({
      role,
      slug,
      map,
      expectedRevision,
      clientId: normalizeRealtimeClientId(body.clientId),
      interactionMode,
    })
    return { ok: true as const, path: result.path, map: result.map }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
