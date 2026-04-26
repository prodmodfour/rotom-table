/**
 * GET /api/grids/load?slug=<slug>
 *
 * Returns the full grid document for the given slug. 404 if not found.
 */
import { createError, defineEventHandler, getQuery } from 'h3'
import { findGridFile, readGridFile, SLUG_RE } from '../../utils/gridStorage'

export default defineEventHandler((event) => {
  const slug = String(getQuery(event).slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const path = findGridFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Grid ${slug}.json not found` })
  }
  return { grid: readGridFile(path) }
})
