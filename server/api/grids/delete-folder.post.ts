/**
 * POST /api/grids/delete-folder
 *
 * Recursively removes a folder under ``data/grids/`` and every grid
 * inside it. Empty parents are pruned.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { existsSync, rmSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  GRIDS_ROOT,
  PROJECT_ROOT,
  pruneEmptyParents,
  sanitizeFolderPath,
} from '../../utils/gridStorage'

interface DeleteFolderBody {
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<DeleteFolderBody>(event)
  let folder = ''
  try {
    folder = sanitizeFolderPath(String(body?.folder ?? ''))
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }

  const dir = join(GRIDS_ROOT, folder)
  if (dir !== GRIDS_ROOT && !dir.startsWith(GRIDS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid folder path' })
  }
  if (!existsSync(dir)) {
    throw createError({ statusCode: 404, statusMessage: `Folder "${folder}" not found` })
  }
  if (!statSync(dir).isDirectory()) {
    throw createError({ statusCode: 400, statusMessage: 'Not a directory' })
  }
  rmSync(dir, { recursive: true, force: true })
  pruneEmptyParents(dir)

  publishRealtime({
    channel: 'grids',
    type: 'folder-deleted',
    clientId: body?.clientId,
    data: { folder },
  })

  return { ok: true as const, removed: dir.slice(PROJECT_ROOT.length + 1) }
})
