import { createError, defineEventHandler } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { requireAuthRole } from '../../utils/auth'
import { expectRecord, expectSlug, readObjectBody } from '../../utils/http'
import { saveMapUseCase, SaveMapUseCaseError } from '../../useCases/saveMap'
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
    for (const realtimeEvent of result.events) publishRealtime(realtimeEvent)
    return { ok: true as const, path: result.path, map: result.map }
  } catch (err) {
    if (err instanceof SaveMapUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
