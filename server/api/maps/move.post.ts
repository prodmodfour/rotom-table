/**
 * POST /api/maps/move
 *
 * Moves a map file into a different folder under ``data/maps/``.
 * Empty `folder` moves the map back to the root.
 *
 * Request body: `{ slug: string, folder: string, clientId?: string }`
 * Response:     `{ ok: true, moved: boolean, path: string }`
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  MAPS_ROOT,
  PROJECT_ROOT,
  SLUG_RE,
  findMapFile,
  pruneEmptyParents,
  readMapFile,
  sanitizeFolderPath,
  writeMapFile,
} from '../../utils/mapStorage'

interface MoveBody {
  slug?: string
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<MoveBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  let folder = ''
  try {
    folder = sanitizeFolderPath(String(body?.folder ?? ''), true)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }

  const currentPath = findMapFile(slug)
  if (!currentPath) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }

  const destDir = folder ? join(MAPS_ROOT, folder) : MAPS_ROOT
  if (destDir !== MAPS_ROOT && !destDir.startsWith(MAPS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }
  const destPath = join(destDir, `${slug}.json`)

  let moved = false
  if (currentPath !== destPath) {
    if (existsSync(destPath)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A map with that name already exists in the target folder',
      })
    }
    mkdirSync(destDir, { recursive: true })
    renameSync(currentPath, destPath)
    pruneEmptyParents(currentPath)
    moved = true
  }

  // Re-read so `folder` is correctly derived from the new path; bump
  // updatedAt for consistency with save/rename.
  const map = readMapFile(destPath)
  map.updatedAt = Date.now()
  writeMapFile(destPath, map)

  publishRealtime({
    channel: `map:${slug}`,
    type: 'updated',
    clientId: body?.clientId,
    data: map,
  })
  publishRealtime({
    channel: 'maps',
    type: 'moved',
    clientId: body?.clientId,
    data: {
      slug: map.slug,
      name: map.name,
      folder: map.folder ?? '',
      dimensions: map.dimensions,
      placementCount: map.placements?.length ?? 0,
      updatedAt: map.updatedAt,
    },
  })

  return {
    ok: true as const,
    moved,
    path: destPath.slice(PROJECT_ROOT.length + 1),
  }
})
