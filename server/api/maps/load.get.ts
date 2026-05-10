/**
 * GET /api/maps/load?slug=<slug>
 *
 * Returns the full map document for the given slug. 404 if not found.
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { loadMapUseCase, LoadMapUseCaseError } from '../../useCases/loadMap'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)

  try {
    return loadMapUseCase({
      role,
      slug: getQuery(event).slug,
    })
  } catch (err) {
    if (err instanceof LoadMapUseCaseError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
