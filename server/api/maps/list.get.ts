/**
 * GET /api/maps/list
 *
 * Returns lightweight summaries (no placements) for every SQLite map.
 * The map browser uses this to render the library view; individual maps
 * are loaded via ``/api/maps/load``.
 */
import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { listMapSummariesUseCase } from '../../useCases/listMapLibrary'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  return listMapSummariesUseCase({ role })
})
