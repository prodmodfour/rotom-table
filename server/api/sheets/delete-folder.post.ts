/**
 * POST /api/sheets/delete-folder
 *
 * Recursively removes a folder from BOTH `data/sheets/` and
 * `data/trainers/` (whichever exists), including every sheet inside.
 * After the delete, empty parent directories are pruned the same way
 * the move endpoints do it.
 *
 * Request body: `{ folder: string }`  — relative path, non-empty.
 * Response:     `{ ok: true, count: number, removed: string[] }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { existsSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath, dirname, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface DeleteFolderBody {
  folder?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const ROOTS = [
  resolvePath(PROJECT_ROOT, 'data/sheets'),
  resolvePath(PROJECT_ROOT, 'data/trainers'),
]
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/

const sanitizeFolder = (path: string): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, '').trim()
  if (!trimmed) {
    throw createError({ statusCode: 400, statusMessage: 'folder must not be empty' })
  }
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

  const body = await readBody<DeleteFolderBody>(event)
  const folder = sanitizeFolder(String(body?.folder ?? ''))

  const removed: string[] = []
  for (const root of ROOTS) {
    const dir = joinPath(root, folder)
    if (dir !== root && !dir.startsWith(root + sep)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid folder path' })
    }
    if (!existsSync(dir)) continue
    if (!statSync(dir).isDirectory()) continue
    rmSync(dir, { recursive: true, force: true })
    pruneEmptyParents(dir, root)
    removed.push(dir.slice(PROJECT_ROOT.length + 1))
  }

  if (removed.length === 0) {
    throw createError({ statusCode: 404, statusMessage: `Folder "${folder}" not found` })
  }

  return { ok: true as const, count: removed.length, removed }
})
