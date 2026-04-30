/**
 * POST /api/maps/rename
 *
 * Updates a map's display name. If the new name slugifies to a
 * different filename, the JSON file is also moved on disk and the
 * map's `slug` field updated; otherwise only the name changes.
 *
 * When the slug changes, a `renamed` event is broadcast on both the
 * old `map:<slug>` channel and the `maps` channel so other tabs /
 * open editors can swap their cached entry / navigate to the new URL.
 *
 * Request body: `{ slug: string, name: string, clientId?: string }`
 * Response:     `{ ok: true, slug: string, name: string, path: string }`
 */
import { existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import { publishRealtime } from '../../utils/realtime'
import {
  PROJECT_ROOT,
  SLUG_RE,
  allocateSlug,
  findMapFile,
  readMapFile,
  slugify,
  writeMapFile,
} from '../../utils/mapStorage'

interface RenameBody {
  slug?: string
  name?: string
  clientId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RenameBody>(event)
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  if (name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'name too long (max 80 chars)' })
  }

  const path = findMapFile(slug)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Map ${slug}.json not found` })
  }

  const map = readMapFile(path)

  // Decide whether the slug also changes. Only re-slugify when the
  // candidate is non-empty and differs from the current slug — that
  // way a name like "!!!" (slugifies to '') leaves the slug alone.
  const desired = slugify(name)
  let newSlug = slug
  let newPath = path
  if (desired && desired !== slug) {
    newSlug = findMapFile(desired) ? allocateSlug(name) : desired
    newPath = join(dirname(path), `${newSlug}.json`)
    if (existsSync(newPath)) {
      throw createError({
        statusCode: 409,
        statusMessage: `Map ${newSlug}.json already exists`,
      })
    }
    renameSync(path, newPath)
    map.slug = newSlug
  }

  map.name = name
  map.updatedAt = Date.now()
  writeMapFile(newPath, map)

  const summary = {
    slug: map.slug,
    name: map.name,
    folder: map.folder ?? '',
    dimensions: map.dimensions,
    placementCount: map.placements?.length ?? 0,
    updatedAt: map.updatedAt,
  }

  if (newSlug !== slug) {
    publishRealtime({
      channel: `map:${slug}`,
      type: 'renamed',
      clientId: body?.clientId,
      data: { oldSlug: slug, newSlug, map },
    })
    publishRealtime({
      channel: `map:${newSlug}`,
      type: 'updated',
      clientId: body?.clientId,
      data: map,
    })
    publishRealtime({
      channel: 'maps',
      type: 'renamed',
      clientId: body?.clientId,
      data: { oldSlug: slug, summary },
    })
  } else {
    publishRealtime({
      channel: `map:${slug}`,
      type: 'updated',
      clientId: body?.clientId,
      data: map,
    })
    publishRealtime({
      channel: 'maps',
      type: 'updated',
      clientId: body?.clientId,
      data: summary,
    })
  }

  return {
    ok: true as const,
    slug: newSlug,
    name,
    path: newPath.slice(PROJECT_ROOT.length + 1),
  }
})
