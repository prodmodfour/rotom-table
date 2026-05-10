import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectRecord, expectSlug, readObjectBody } from '../../utils/http'
import { saveMapUseCase } from '../../useCases/saveMap'
import type { TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: unknown
  map?: unknown
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<SaveBody>(event)
  const slug = expectSlug(body.slug)
  const map = expectRecord(body.map, 'map') as unknown as TabletopMap

  try {
    const result = saveMapUseCase({
      role,
      slug,
      map,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    })
    publishUseCaseRealtimeEvents(result.events)
    return { ok: true as const, path: result.path, map: result.map }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
