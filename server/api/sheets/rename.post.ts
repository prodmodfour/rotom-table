/**
 * POST /api/sheets/rename
 *
 * Updates the display name on a sheet (the `nickname` field for Pokémon,
 * the `name` field for trainers). The slug / filename is left untouched
 * so deep links to the sheet stay valid.
 *
 * Request body:
 *   { kind: 'pokemon' | 'trainer', slug: string, name: string }
 *
 * Response: `{ ok: true, name: string, path: string }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface RenameBody {
  kind?: 'pokemon' | 'trainer'
  slug?: string
  name?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SLUG_RE = /^[a-z0-9-]+$/

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

  const body = await readBody<RenameBody>(event)
  if (body?.kind !== 'pokemon' && body?.kind !== 'trainer') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "pokemon" or "trainer"' })
  }
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  if (name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'name too long (max 80 chars)' })
  }

  const root = resolvePath(
    PROJECT_ROOT,
    body.kind === 'pokemon' ? 'data/sheets' : 'data/trainers',
  )
  const path = findFile(root, `${slug}.json`)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Sheet ${slug}.json not found` })
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: `Failed to parse ${path}: ${err}` })
  }

  const field = body.kind === 'pokemon' ? 'nickname' : 'name'
  json[field] = name
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8')

  return {
    ok: true as const,
    name,
    path: path.slice(PROJECT_ROOT.length + 1),
  }
})
