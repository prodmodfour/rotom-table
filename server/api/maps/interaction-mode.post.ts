import { defineEventHandler } from 'h3'
import { parseMapInteractionMode } from '#shared/mapInteractionMode'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireGm } from '../../utils/auth'
import { badRequest, expectSlug, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { setMapInteractionModeUseCase } from '../../useCases/setMapInteractionMode'

interface SetMapInteractionModeBody {
  readonly slug?: unknown
  readonly interactionMode?: unknown
  readonly clientId?: unknown
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SetMapInteractionModeBody>(event)
  const slug = expectSlug(body.slug)
  const interactionMode = parseMapInteractionMode(body.interactionMode)
    ?? badRequest('interactionMode must be "setup-edit" or "live-play"')

  try {
    const result = await setMapInteractionModeUseCase({
      slug,
      interactionMode,
      clientId: normalizeRealtimeClientId(body.clientId),
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      slug: result.slug,
      interactionMode: result.interactionMode,
      previousInteractionMode: result.previousInteractionMode,
      updatedAt: result.updatedAt,
      syncedMapForLivePlay: result.syncedMapForLivePlay,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
