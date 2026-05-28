import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectRecord, expectSlug, readObjectBody } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { saveMapUseCase } from '../../useCases/saveMap'
import { normalizeRealtimeClientId } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: unknown
  map?: unknown
  clientId?: unknown
  profileId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<SaveBody>(event)
  const slug = expectSlug(body.slug)
  const map = expectRecord(body.map, 'map') as unknown as TabletopMap

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = saveMapUseCase({
      role,
      slug,
      map,
      clientId: normalizeRealtimeClientId(body.clientId),
      playerProfile,
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: true as const, path: result.path, map: result.map }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
