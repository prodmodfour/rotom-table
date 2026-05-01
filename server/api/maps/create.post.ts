/**
 * POST /api/maps/create
 *
 * Creates a new empty map. Slug is auto-allocated from the supplied
 * name (or a default), with numeric suffixes if the base slug is
 * taken. Default dimensions match `DEFAULT_GRID_DIMENSIONS` in the
 * client utils so the editor renders something sensible immediately.
 *
 * Request body (all optional):
 *   { name?: string, folder?: string, dimensions?: GridDimensions, clientId?: string }
 *
 * Response: `{ map: TabletopMap }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { join } from 'node:path'
import { publishRealtime } from '../../utils/realtime'
import {
  MAPS_ROOT,
  allocateSlug,
  ensureMapsRoot,
  sanitizeFolderPath,
  writeMapFile,
} from '../../utils/mapStorage'
import type { GridDimensions, TabletopMap } from '~/types/map'

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
  const name = String(body?.name ?? '').trim() || 'Untitled Map'
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

  ensureMapsRoot()
  const slug = allocateSlug(name)
  const now = Date.now()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug,
    name,
    folder,
    dimensions,
    assetPacks: [],
    placements: [],
    initiative: { activeId: null, round: 1 },
    voxels: [],
    decals: [],
    props: [],
    zones: [],
    doors: [],
    lights: [],
    createdAt: now,
    updatedAt: now,
  }

  const path = folder
    ? join(MAPS_ROOT, folder, `${slug}.json`)
    : join(MAPS_ROOT, `${slug}.json`)
  writeMapFile(path, map)

  publishRealtime({
    channel: 'maps',
    type: 'created',
    clientId: body?.clientId,
    data: {
      slug: map.slug,
      name: map.name,
      folder: map.folder ?? '',
      dimensions: map.dimensions,
      placementCount: 0,
      schemaVersion: map.schemaVersion,
      updatedAt: map.updatedAt,
    },
  })

  return { map }
})
