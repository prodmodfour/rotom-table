/**
 * POST /api/grids/delete
 *
 * Removes a grid file. Empty parent directories are pruned.
 *
 * Request body: `{ slug: string, clientId?: string }`
 * Response:     `{ ok: true, path: string }`
 */
import { unlinkSync } from 'node:fs'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  PROJECT_ROOT,
  SLUG_RE,
  findGridFile,
  pruneEmptyParents,
} from '../../utils/gridStorage'

interface DeleteBody {
  slug?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<DeleteBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const path = findGridFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Grid ${slug}.json not found` })
  }
  unlinkSync(path)
  pruneEmptyParents(path)

  publishRealtime({
    channel: `grid:${slug}`,
    type: 'deleted',
    clientId: body?.clientId,
    data: { slug },
  })
  publishRealtime({
    channel: 'grids',
    type: 'deleted',
    clientId: body?.clientId,
    data: { slug },
  })

  return { ok: true as const, path: path.slice(PROJECT_ROOT.length + 1) }
})
