/**
 * POST /api/sheets/move
 *
 * Moves a single Pokémon or trainer sheet JSON file into a different folder
 * under its respective root (`data/sheets/` for Pokémon, `data/trainers/`
 * for trainers). Empty `folder` moves the sheet back to the root.
 *
 * Request body:
 *   {
 *     kind:    'pokemon' | 'trainer',
 *     slug:    string,        // matches /^[a-z0-9-]+$/, also the filename stem
 *     folder:  string,        // path under the root, '' for root
 *   }
 *
 * Response: `{ ok: true, moved: boolean, path: string }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { resolve as resolvePath, join as joinPath, dirname, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface MoveSheetBody {
  kind?: 'pokemon' | 'trainer'
  slug?: string
  folder?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/
const SLUG_RE = /^[a-z0-9-]+$/

const sanitizeFolder = (path: string): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, '').trim()
  if (!trimmed) return ''
  for (const seg of trimmed.split('/')) {
    if (!SAFE_SEGMENT.test(seg)) {
      throw createError({
        statusCode: 400,
        statusMessage: `folder segment "${seg}" must match /^[A-Za-z0-9_-]+$/`,
      })
    }
  }
  return trimmed
}

/** Walk `root` and return the first file matching `fileName`, or null. */
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

/** Remove now-empty parent directories of `path`, walking up until we leave `root`. */
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

  const body = await readBody<MoveSheetBody>(event)
  if (body?.kind !== 'pokemon' && body?.kind !== 'trainer') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "pokemon" or "trainer"' })
  }
  const slug = String(body?.slug ?? '')
  if (!SLUG_RE.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'slug must match /^[a-z0-9-]+$/' })
  }
  const folder = sanitizeFolder(String(body?.folder ?? ''))

  const root = resolvePath(
    PROJECT_ROOT,
    body.kind === 'pokemon' ? 'data/sheets' : 'data/trainers',
  )
  const fileName = `${slug}.json`
  const currentPath = findFile(root, fileName)
  if (!currentPath) {
    throw createError({ statusCode: 404, statusMessage: `Sheet ${fileName} not found` })
  }

  const destDir = folder ? joinPath(root, folder) : root
  if (destDir !== root && !destDir.startsWith(root + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }
  const destPath = joinPath(destDir, fileName)

  let moved = false
  if (currentPath !== destPath) {
    if (existsSync(destPath)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A sheet with that name already exists in the target folder',
      })
    }
    mkdirSync(destDir, { recursive: true })
    renameSync(currentPath, destPath)
    pruneEmptyParents(currentPath, root)
    moved = true
  }

  // If the sheet had an explicit `folder` field that no longer matches the
  // path, drop it so the on-disk path becomes the source of truth.
  try {
    const raw = readFileSync(destPath, 'utf8')
    const json = JSON.parse(raw)
    if (Object.prototype.hasOwnProperty.call(json, 'folder')) {
      delete json.folder
      writeFileSync(destPath, JSON.stringify(json, null, 2) + '\n', 'utf8')
    }
  } catch (err) {
    // Don't fail the move if rewrite fails; surface the issue but keep going.
    console.warn('[sheets/move] rewrite failed for', destPath, err)
  }

  return {
    ok: true as const,
    moved,
    path: destPath.slice(PROJECT_ROOT.length + 1),
  }
})
