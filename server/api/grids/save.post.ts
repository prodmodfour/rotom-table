/**
 * POST /api/grids/save
 *
 * Persists a full grid JSON in place. The grid's on-disk path is
 * located by walking ``data/grids/`` for ``<slug>.json``. The slug must
 * match ``body.grid.slug``.
 *
 * Request body: `{ slug: string, grid: Grid, clientId?: string }`
 * Response:     `{ ok: true, path: string, grid: Grid }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  PROJECT_ROOT,
  SLUG_RE,
  findGridFile,
  folderFromPath,
  writeGridFile,
} from '../../utils/gridStorage'
import type { Grid } from '~/types/grid'

interface SaveBody {
  slug?: string
  grid?: Grid
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SaveBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const grid = body?.grid
  if (!grid || typeof grid !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'grid must be an object' })
  }
  if (grid.slug !== slug) {
    throw createError({
      statusCode: 400,
      statusMessage: `grid.slug "${grid.slug}" must match request slug "${slug}"`,
    })
  }

  const path = findGridFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Grid ${slug}.json not found` })
  }

  const persisted: Grid = {
    ...grid,
    folder: folderFromPath(path),
    voxels: Array.isArray(grid.voxels) ? grid.voxels : [],
    updatedAt: Date.now(),
  }
  writeGridFile(path, persisted)

  publishRealtime({
    channel: `grid:${slug}`,
    type: 'updated',
    clientId: body?.clientId,
    data: persisted,
  })
  publishRealtime({
    channel: 'grids',
    type: 'updated',
    clientId: body?.clientId,
    data: {
      slug: persisted.slug,
      name: persisted.name,
      folder: persisted.folder ?? '',
      dimensions: persisted.dimensions,
      placementCount: persisted.placements?.length ?? 0,
      updatedAt: persisted.updatedAt,
    },
  })

  return {
    ok: true as const,
    path: path.slice(PROJECT_ROOT.length + 1),
    grid: persisted,
  }
})
