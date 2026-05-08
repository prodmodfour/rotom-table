/**
 * POST /api/maps/delete
 *
 * Removes a map file. Empty parent directories are pruned.
 *
 * Request body: `{ slug: string, clientId?: string }`
 * Response:     `{ ok: true, path: string }`
 */
import { unlinkSync } from 'node:fs'
import { createError, defineEventHandler, readBody } from 'h3'
import { mapChannel, mapsChannel } from '~/shared/realtime'
import { publishRealtime } from '../../utils/realtime'
import { requireGm } from '../../utils/auth'
import { PROJECT_ROOT } from '../../utils/fsPaths'
import {
  SLUG_RE,
  findMapFile,
  pruneEmptyMapParents,
} from '../../utils/mapStorage'

interface DeleteBody {
  slug?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<DeleteBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const path = findMapFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }
  unlinkSync(path)
  pruneEmptyMapParents(path)

  publishRealtime({
    channel: mapChannel(slug),
    type: 'deleted',
    clientId: body?.clientId,
    data: { slug },
  })
  publishRealtime({
    channel: mapsChannel,
    type: 'deleted',
    clientId: body?.clientId,
    data: { slug },
  })

  return { ok: true as const, path: path.slice(PROJECT_ROOT.length + 1) }
})
