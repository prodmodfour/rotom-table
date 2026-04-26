/**
 * POST /api/grids/create-folder
 *
 * Creates an empty folder under ``data/grids/`` so it's visible in the
 * browser before any grid lives in it.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import { GRIDS_ROOT, PROJECT_ROOT, sanitizeFolderPath } from '../../utils/gridStorage'

interface CreateFolderBody {
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateFolderBody>(event)
  let folder = ''
  try {
    folder = sanitizeFolderPath(String(body?.folder ?? ''))
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  const dest = join(GRIDS_ROOT, folder)
  if (!dest.startsWith(GRIDS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }
  const existed = existsSync(dest)
  mkdirSync(dest, { recursive: true })

  publishRealtime({
    channel: 'grids',
    type: 'folder-created',
    clientId: body?.clientId,
    data: { folder },
  })

  return {
    ok: true as const,
    created: !existed,
    path: dest.slice(PROJECT_ROOT.length + 1),
  }
})
