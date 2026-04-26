/**
 * POST /api/grids/move-folder
 *
 * Renames or relocates a folder under ``data/grids/``.
 *
 * Request body: `{ from: string, to: string, clientId?: string }`
 */
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  GRIDS_ROOT,
  pruneEmptyParents,
  sanitizeFolderPath,
} from '../../utils/gridStorage'

interface MoveFolderBody {
  from?: string
  to?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<MoveFolderBody>(event)
  let from = ''
  let to = ''
  try {
    from = sanitizeFolderPath(String(body?.from ?? ''))
    to = sanitizeFolderPath(String(body?.to ?? ''))
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  if (from === to) return { ok: true as const, moved: false }
  if (to === from || to.startsWith(from + '/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot move a folder into itself or one of its descendants',
    })
  }

  const src = join(GRIDS_ROOT, from)
  const dst = join(GRIDS_ROOT, to)
  if (!src.startsWith(GRIDS_ROOT + sep) || !dst.startsWith(GRIDS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid path' })
  }
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw createError({ statusCode: 404, statusMessage: `Folder "${from}" not found` })
  }
  if (existsSync(dst)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Destination folder already exists',
    })
  }

  mkdirSync(dirname(dst), { recursive: true })
  renameSync(src, dst)
  pruneEmptyParents(src)

  publishRealtime({
    channel: 'grids',
    type: 'folder-moved',
    clientId: body?.clientId,
    data: { from, to },
  })

  return { ok: true as const, moved: true }
})
