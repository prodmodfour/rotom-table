/**
 * POST /api/grids/move
 *
 * Moves a grid file into a different folder under ``data/grids/``.
 * Empty `folder` moves the grid back to the root.
 *
 * Request body: `{ slug: string, folder: string, clientId?: string }`
 * Response:     `{ ok: true, moved: boolean, path: string }`
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  GRIDS_ROOT,
  PROJECT_ROOT,
  SLUG_RE,
  findGridFile,
  pruneEmptyParents,
  readGridFile,
  sanitizeFolderPath,
  writeGridFile,
} from '../../utils/gridStorage'

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

  const currentPath = findGridFile(slug)
  if (!currentPath) {
    throw createError({ statusCode: 404, statusMessage: `Grid ${slug}.json not found` })
  }

  const destDir = folder ? join(GRIDS_ROOT, folder) : GRIDS_ROOT
  if (destDir !== GRIDS_ROOT && !destDir.startsWith(GRIDS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }
  const destPath = join(destDir, `${slug}.json`)

  let moved = false
  if (currentPath !== destPath) {
    if (existsSync(destPath)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A grid with that name already exists in the target folder',
      })
    }
    mkdirSync(destDir, { recursive: true })
    renameSync(currentPath, destPath)
    pruneEmptyParents(currentPath)
    moved = true
  }

  // Re-read so `folder` is correctly derived from the new path; bump
  // updatedAt for consistency with save/rename.
  const grid = readGridFile(destPath)
  grid.updatedAt = Date.now()
  writeGridFile(destPath, grid)

  publishRealtime({
    channel: `grid:${slug}`,
    type: 'updated',
    clientId: body?.clientId,
    data: grid,
  })
  publishRealtime({
    channel: 'grids',
    type: 'moved',
    clientId: body?.clientId,
    data: {
      slug: grid.slug,
      name: grid.name,
      folder: grid.folder ?? '',
      dimensions: grid.dimensions,
      placementCount: grid.placements?.length ?? 0,
      updatedAt: grid.updatedAt,
    },
  })

  return {
    ok: true as const,
    moved,
    path: destPath.slice(PROJECT_ROOT.length + 1),
  }
})
