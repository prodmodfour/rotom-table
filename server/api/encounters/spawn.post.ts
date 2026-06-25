/**
 * POST /api/encounters/spawn
 *
 * Generates a persistent encounter sheet folder, then places each successfully
 * generated Pokémon sheet onto the requested map at a random terrain-aware
 * position.
 */
import { defineEventHandler, readBody } from 'h3'
import { isSlug } from '#shared/paths'
import { isSheetKind } from '#shared/sheets'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import {
  publishUseCaseRealtimeEvents,
  throwUseCaseHttpError,
  type UseCaseRealtimeEvent,
} from '../../utils/useCaseHttp'
import {
  spawnGeneratedEncountersUseCase,
  type SpawnEncounterBody,
} from '../../useCases/spawnGeneratedEncounters'

const sheetAccessForEvent = (event: { readonly data?: unknown }) => {
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : null
  if (data && isSheetKind(data.kind) && isSlug(data.slug)) {
    return { kind: 'sheet-access' as const, sheetKind: data.kind, sheetSlug: data.slug }
  }
  return null
}

const scopedEncounterSpawnEvents = (
  events: readonly UseCaseRealtimeEvent[],
  mapSlug: string,
) => {
  if (!isSlug(mapSlug)) throw new Error('encounter spawn realtime map slug is invalid')
  return events.map((event) => ({
    event,
    access: sheetAccessForEvent(event) ?? { kind: 'map-access' as const, mapSlug },
  }))
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readBody<SpawnEncounterBody | null>(event)

  try {
    const result = await spawnGeneratedEncountersUseCase(body)
    publishUseCaseRealtimeEvents(scopedEncounterSpawnEvents(result.events, result.spawn.mapSlug))
    const { events: _events, ...response } = result
    return response
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
