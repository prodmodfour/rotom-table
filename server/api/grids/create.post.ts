/**
 * POST /api/grids/create
 *
 * Creates a new empty grid. Slug is auto-allocated from the supplied
 * name (or a default), with numeric suffixes if the base slug is
 * taken. Default dimensions match `DEFAULT_GRID_DIMENSIONS` in the
 * client utils so the editor renders something sensible immediately.
 *
 * Request body (all optional):
 *   { name?: string, folder?: string, dimensions?: GridDimensions, clientId?: string }
 *
 * Response: `{ grid: Grid }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { join } from 'node:path'
import { publishRealtime } from '../../utils/realtime'
import {
  GRIDS_ROOT,
  allocateSlug,
  ensureGridsRoot,
  sanitizeFolderPath,
  writeGridFile,
} from '../../utils/gridStorage'
import type { Grid, GridDimensions } from '~/types/grid'

interface CreateBody {
  name?: string
  folder?: string
  dimensions?: GridDimensions
  clientId?: string
}

const DEFAULT_DIMENSIONS: GridDimensions = { x: 20, y: 12, z: 20 }

const clamp = (value: unknown, fallback: number) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(200, Math.max(1, Math.round(n)))
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateBody>(event)
  const name = String(body?.name ?? '').trim() || 'Untitled Grid'
  if (name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'name too long (max 80 chars)' })
  }

  let folder = ''
  try {
    folder = sanitizeFolderPath(String(body?.folder ?? ''), true)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }

  const dims = body?.dimensions ?? DEFAULT_DIMENSIONS
  const dimensions: GridDimensions = {
    x: clamp(dims.x, DEFAULT_DIMENSIONS.x),
    y: clamp(dims.y, DEFAULT_DIMENSIONS.y),
    z: clamp(dims.z, DEFAULT_DIMENSIONS.z),
  }

  ensureGridsRoot()
  const slug = allocateSlug(name)
  const now = Date.now()
  const grid: Grid = {
    slug,
    name,
    folder,
    dimensions,
    placements: [],
    createdAt: now,
    updatedAt: now,
  }

  const path = folder
    ? join(GRIDS_ROOT, folder, `${slug}.json`)
    : join(GRIDS_ROOT, `${slug}.json`)
  writeGridFile(path, grid)

  publishRealtime({
    channel: 'grids',
    type: 'created',
    clientId: body?.clientId,
    data: {
      slug: grid.slug,
      name: grid.name,
      folder: grid.folder ?? '',
      dimensions: grid.dimensions,
      placementCount: 0,
      updatedAt: grid.updatedAt,
    },
  })

  return { grid }
})
