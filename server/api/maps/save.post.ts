/**
 * POST /api/maps/save
 *
 * Persists a full map JSON in place. The map's on-disk path is
 * located by walking ``data/maps/`` for ``<slug>.json``. The slug must
 * match ``body.map.slug``.
 *
 * Request body: `{ slug: string, map: TabletopMap, clientId?: string }`
 * Response:     `{ ok: true, path: string, map: TabletopMap }`
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  PROJECT_ROOT,
  SLUG_RE,
  findMapFile,
  folderFromPath,
  writeMapFile,
} from '../../utils/mapStorage'
import type { TabletopMap } from '~/types/map'

interface SaveBody {
  slug?: string
  map?: TabletopMap
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SaveBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const map = body?.map
  if (!map || typeof map !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'map must be an object' })
  }
  if (map.slug !== slug) {
    throw createError({
      statusCode: 400,
      statusMessage: `map.slug "${map.slug}" must match request slug "${slug}"`,
    })
  }

  const path = findMapFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }

  const persisted: TabletopMap = {
    ...map,
    folder: folderFromPath(path),
    voxels: Array.isArray(map.voxels) ? map.voxels : [],
    updatedAt: Date.now(),
  }
  writeMapFile(path, persisted)

  publishRealtime({
    channel: `map:${slug}`,
    type: 'updated',
    clientId: body?.clientId,
    data: persisted,
  })
  publishRealtime({
    channel: 'maps',
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
    map: persisted,
  }
})
