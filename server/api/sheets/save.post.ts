/**
 * POST /api/sheets/save
 *
 * Persists a full sheet JSON to disk, replacing the existing file in-place.
 * The sheet's on-disk path is located by walking the appropriate root
 * (`data/sheets/` for Pokémon, `data/trainers/` for trainers) for the
 * file `${slug}.json`. The slug must match `body.sheet.slug` so we can't
 * accidentally rewrite the wrong file.
 *
 * Request body:
 *   {
 *     kind:  'pokemon' | 'trainer',
 *     slug:  string,
 *     sheet: object,   // full replacement; must contain a `slug` field that matches
 *   }
 *
 * Response: `{ ok: true, path: string }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface SaveBody {
  kind?: 'pokemon' | 'trainer'
  slug?: string
  sheet?: Record<string, unknown>
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SLUG_RE = /^[a-z0-9-]+$/

/** Walk `root` recursively and return the first `fileName` match. */
const findFile = (root: string, fileName: string): string | null => {
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = joinPath(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === fileName) return full
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 403, statusMessage: 'Disabled in production' })
  }

  const body = await readBody<SaveBody>(event)
  if (body?.kind !== 'pokemon' && body?.kind !== 'trainer') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "pokemon" or "trainer"' })
  }
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const sheet = body?.sheet
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    throw createError({ statusCode: 400, statusMessage: 'sheet must be an object' })
  }
  // The slug embedded in the payload must match the slug we're writing to —
  // otherwise we'd silently write someone else's sheet.
  const payloadSlug = String((sheet as Record<string, unknown>).slug ?? '')
  if (payloadSlug !== slug) {
    throw createError({
      statusCode: 400,
      statusMessage: `sheet.slug "${payloadSlug}" must match request slug "${slug}"`,
    })
  }

  const root = resolvePath(
    PROJECT_ROOT,
    body.kind === 'pokemon' ? 'data/sheets' : 'data/trainers',
  )
  const path = findFile(root, `${slug}.json`)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Sheet ${slug}.json not found` })
  }

  // Strip the `folder` field if present — it gets re-derived from the path
  // by the loader, and storing it would just create an ongoing source of
  // drift. (Same convention as `move.post.ts`.)
  const out: Record<string, unknown> = { ...(sheet as Record<string, unknown>) }
  if ('folder' in out) delete out.folder

  writeFileSync(path, JSON.stringify(out, null, 2) + '\n', 'utf8')

  return {
    ok: true as const,
    path: path.slice(PROJECT_ROOT.length + 1),
  }
})
