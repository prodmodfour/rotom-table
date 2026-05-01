/**
 * GET /api/maps/load?slug=<slug>
 *
 * Returns the full map document for the given slug. 404 if not found.
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { findMapFile, readMapFile, SLUG_RE } from '../../utils/mapStorage'

export default defineEventHandler((event) => {
  const slug = String(getQuery(event).slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const path = findMapFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }
  try {
    return { map: readMapFile(path) }
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: (err as Error).message || `Map ${slug}.json is invalid`,
    })
  }
})
