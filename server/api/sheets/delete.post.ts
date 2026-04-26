/**
 * POST /api/sheets/delete
 *
 * Removes a single sheet's JSON file from disk. Empty parent directories
 * are pruned (mirroring the behaviour of `move`), so deleting the only
 * sheet inside `data/sheets/team-alpha/` removes the directory too.
 *
 * Request body: `{ kind: 'pokemon' | 'trainer', slug: string }`
 * Response:     `{ ok: true, path: string }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath, dirname, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface DeleteBody {
  kind?: 'pokemon' | 'trainer'
  slug?: string
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

const pruneEmptyParents = (path: string, root: string) => {
  let parent = dirname(path)
  while (parent.startsWith(root + sep) && parent !== root) {
    try {
      if (readdirSync(parent).length > 0) break
      rmdirSync(parent)
    } catch {
      break
    }
    parent = dirname(parent)
  }
}

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 403, statusMessage: 'Disabled in production' })
  }

  const body = await readBody<DeleteBody>(event)
  if (body?.kind !== 'pokemon' && body?.kind !== 'trainer') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "pokemon" or "trainer"' })
  }
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }

  const root = resolvePath(
    PROJECT_ROOT,
    body.kind === 'pokemon' ? 'data/sheets' : 'data/trainers',
  )
  const path = findFile(root, `${slug}.json`)
  if (!path) {
    throw createError({ statusCode: 404, statusMessage: `Sheet ${slug}.json not found` })
  }

  unlinkSync(path)
  pruneEmptyParents(path, root)

  return { ok: true as const, path: path.slice(PROJECT_ROOT.length + 1) }
})
