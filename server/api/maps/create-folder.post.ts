/**
 * POST /api/maps/create-folder
 *
 * Creates an empty folder under ``data/maps/`` so it's visible in the
 * browser before any map lives in it.
 *
 * Request body: `{ folder: string, clientId?: string }`
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { mapsChannel } from '~/shared/realtime'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { PROJECT_ROOT } from '../../utils/fsPaths'
import { MAPS_ROOT, sanitizeMapFolderPath } from '../../utils/mapStorage'

interface CreateFolderBody {
  folder?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<CreateFolderBody>(event)
  let folder = ''
  try {
    folder = sanitizeMapFolderPath(String(body?.folder ?? ''))
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  const dest = join(MAPS_ROOT, folder)
  if (!dest.startsWith(MAPS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }
  const existed = existsSync(dest)
  mkdirSync(dest, { recursive: true })

  publishRealtime({
    channel: mapsChannel,
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
