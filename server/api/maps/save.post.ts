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
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
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

  const initiative = map.initiative && typeof map.initiative === 'object'
    ? map.initiative
    : { activeId: null, round: 1 }
  const mapWithoutRetiredObjectLayers = { ...(map as Record<string, unknown>) }
  delete mapWithoutRetiredObjectLayers.decals
  delete mapWithoutRetiredObjectLayers.props
  delete mapWithoutRetiredObjectLayers.zones
  delete mapWithoutRetiredObjectLayers.doors

  const persisted: TabletopMap = {
    ...(mapWithoutRetiredObjectLayers as unknown as TabletopMap),
    schemaVersion: 2,
    folder: folderFromPath(path),
    initiative,
    assetPacks: Array.isArray(map.assetPacks) ? map.assetPacks : [],
    voxels: Array.isArray(map.voxels)
      ? map.voxels.filter((voxel) => !getVoxelMaterialDefinition(voxel).transparent)
      : [],
    placements: Array.isArray(map.placements) ? map.placements : [],
    lights: Array.isArray(map.lights) ? map.lights : [],
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
      schemaVersion: persisted.schemaVersion,
      updatedAt: persisted.updatedAt,
    },
  })

  return {
    ok: true as const,
    path: path.slice(PROJECT_ROOT.length + 1),
    map: persisted,
  }
})
