/**
 * GET /api/maps/load?slug=<slug>
 *
 * Returns the full map document for the given slug. 404 if not found.
 */
import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { projectAbilityAutomationMapForPlayer } from '../../domain/abilityAutomation/clientStateProjection'
import { loadMapUseCase } from '../../useCases/loadMap'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    const result = loadMapUseCase({
      role,
      slug: getQuery(event).slug,
    })
    return role === 'player'
      ? { ...result, map: projectAbilityAutomationMapForPlayer(result.map) }
      : result
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
