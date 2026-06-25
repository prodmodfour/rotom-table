/**
 * POST /api/encounters/spawn
 *
 * Generates encounter sheet documents in memory, then atomically persists the
 * generated sheets and any setup-map placements through SQLite.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
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
    const { realtimeEvents: _realtimeEvents, ...response } = result
    return response
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
