/**
 * GET /api/maps/list
 *
 * Returns lightweight summaries (no placements) for every map file
 * under ``data/maps/``. The map browser uses this to render the
 * file-explorer view; individual maps are loaded via ``/api/maps/load``.
 */
import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { listMaps } from '../../utils/mapStorage'

export default defineEventHandler((event) => {
  const role = requireAuthRole(event)
  const maps = listMaps()
  return { maps: role === 'player' ? maps.filter((map) => map.playerVisible === true) : maps }
})
