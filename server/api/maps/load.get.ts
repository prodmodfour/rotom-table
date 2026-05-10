/**
 * GET /api/maps/load?slug=<slug>
 *
 * Returns the full map document for the given slug. 404 if not found.
 */
import { defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { loadMapUseCase } from '../../useCases/loadMap'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return loadMapUseCase({
      role,
      slug: getQuery(event).slug,
    })
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
