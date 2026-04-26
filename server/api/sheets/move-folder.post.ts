/**
 * POST /api/sheets/move-folder
 *
 * Renames / relocates a sheet folder. Folder paths are relative to each
 * sheet root — when the folder exists in both `data/sheets/` and
 * `data/trainers/`, both copies are moved so the unified Sheets index
 * stays consistent.
 *
 * Request body:
 *   {
 *     from: string,   // current folder path (must be non-empty)
 *     to:   string,   // new folder path (non-empty; cannot be inside `from`)
 *   }
 *
 * Response: `{ ok: true, moved: boolean, count: number }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
} from 'node:fs'
import { resolve as resolvePath, join as joinPath, dirname, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface MoveFolderBody {
  from?: string
  to?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/
const ROOTS = [
  resolvePath(PROJECT_ROOT, 'data/sheets'),
  resolvePath(PROJECT_ROOT, 'data/trainers'),
]

const sanitizeFolder = (path: string, label: string): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, '').trim()
  if (!trimmed) {
    throw createError({ statusCode: 400, statusMessage: `${label} must not be empty` })
  }
  for (const seg of trimmed.split('/')) {
    if (!SAFE_SEGMENT.test(seg)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${label} segment "${seg}" must match /^[A-Za-z0-9_-]+$/`,
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

  const body = await readBody<MoveFolderBody>(event)
  const from = sanitizeFolder(String(body?.from ?? ''), 'from')
  const to = sanitizeFolder(String(body?.to ?? ''), 'to')

  if (from === to) return { ok: true as const, moved: false, count: 0 }
  if (to === from || to.startsWith(from + '/')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot move a folder into itself or one of its descendants',
    })
  }

  // Plan the moves up front so we can fail fast if either destination already
  // exists, without leaving a half-moved state on disk.
  const moves: Array<{ src: string; dst: string; root: string }> = []
  for (const root of ROOTS) {
    const src = joinPath(root, from)
    if (!existsSync(src)) continue
    if (!statSync(src).isDirectory()) continue
    const dst = joinPath(root, to)
    if (dst !== root && !dst.startsWith(root + sep)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
    }
    if (existsSync(dst)) {
      throw createError({
        statusCode: 409,
        statusMessage: `Destination already exists in ${root.slice(PROJECT_ROOT.length + 1)}`,
      })
    }
    moves.push({ src, dst, root })
  }

  if (moves.length === 0) {
    throw createError({ statusCode: 404, statusMessage: `Folder "${from}" not found` })
  }

  for (const { src, dst } of moves) {
    mkdirSync(dirname(dst), { recursive: true })
    renameSync(src, dst)
  }

  for (const { src, root } of moves) pruneEmptyParents(src, root)

  return { ok: true as const, moved: true, count: moves.length }
})
