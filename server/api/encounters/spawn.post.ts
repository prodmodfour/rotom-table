/**
 * POST /api/encounters/spawn
 *
 * Generates a persistent encounter sheet folder, then places each successfully
 * generated Pokémon sheet onto the requested map at a random terrain-aware
 * position.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import {
  spawnGeneratedEncountersUseCase,
  type SpawnEncounterBody,
} from '../../useCases/spawnGeneratedEncounters'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  const body = await readBody<SpawnEncounterBody | null>(event)

  try {
    const result = await spawnGeneratedEncountersUseCase(body)
    publishUseCaseRealtimeEvents(result.events)
    const { events: _events, ...response } = result
    return response
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
