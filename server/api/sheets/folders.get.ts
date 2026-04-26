/**
 * GET /api/sheets/folders
 *
 * Lists every subdirectory under `data/sheets/` and `data/trainers/`,
 * relative to each root, and returns their union. The Sheets page uses
 * this on mount to surface *empty* folders (which would otherwise be
 * invisible because folder grouping is normally inferred from the paths
 * of existing JSON files).
 *
 * Response: `{ folders: string[] }`  — sorted, no duplicates, no root.
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { existsSync, readdirSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath } from 'node:path'
import { defineEventHandler, createError } from 'h3'

const PROJECT_ROOT = resolvePath(process.cwd())
const ROOTS = [
  resolvePath(PROJECT_ROOT, 'data/sheets'),
  resolvePath(PROJECT_ROOT, 'data/trainers'),
]

/** Walk `root` and yield every subdirectory path relative to `root`. */
const walkDirs = (root: string): string[] => {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }]
  while (stack.length) {
    const { abs, rel } = stack.pop()!
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      out.push(childRel)
      stack.push({ abs: joinPath(abs, entry.name), rel: childRel })
    }
  }
  return out
}

export default defineEventHandler(() => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 403, statusMessage: 'Disabled in production' })
  }
  const set = new Set<string>()
  for (const root of ROOTS) for (const path of walkDirs(root)) set.add(path)
  const folders = Array.from(set).sort((a, b) => a.localeCompare(b))
  return { folders }
})
