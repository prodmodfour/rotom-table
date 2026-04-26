/**
 * GET /api/grids/list
 *
 * Returns lightweight summaries (no placements) for every grid file
 * under ``data/grids/``. The grid browser uses this to render the
 * file-explorer view; individual grids are loaded via ``/api/grids/load``.
 */
import { defineEventHandler } from 'h3'
import { listGrids } from '../../utils/gridStorage'

export default defineEventHandler(() => ({ grids: listGrids() }))
