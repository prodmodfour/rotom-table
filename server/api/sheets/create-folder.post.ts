/**
 * POST /api/sheets/create-folder
 *
 * Creates a new sheet folder on disk so it shows up as a drop target on the
 * Sheets index even before any sheet lives in it. The directory is created
 * under `data/sheets/` only — the move endpoints `mkdir -p` the matching
 * `data/trainers/` path automatically the first time a trainer is dropped
 * into the folder.
 *
 * Request body: `{ folder: string }`  — relative path, `/` for nesting.
 * Response:     `{ ok: true, created: boolean, path: string }`
 *
 * Idempotent — creating an existing folder returns `created: false`.
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'

interface CreateFolderBody {
  folder?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SHEETS_ROOT = resolvePath(PROJECT_ROOT, 'data/sheets')
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

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 403, statusMessage: 'Disabled in production' })
  }

  const body = await readBody<CreateFolderBody>(event)
  const folder = sanitizeFolder(String(body?.folder ?? ''))

  const dest = joinPath(SHEETS_ROOT, folder)
  if (!dest.startsWith(SHEETS_ROOT + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }

  const existed = existsSync(dest)
  mkdirSync(dest, { recursive: true })

  return {
    ok: true as const,
    created: !existed,
    path: dest.slice(PROJECT_ROOT.length + 1),
  }
})
