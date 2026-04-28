/**
 * POST /api/sheets/create
 *
 * Creates a fresh, empty Pokémon or trainer sheet on disk inside the
 * requested folder (defaults to root). The slug is auto-allocated — `new-pokemon`,
 * `new-pokemon-1`, … — by walking the appropriate root and looking for the
 * first available `${slug}.json`. The new sheet contains only the bare
 * minimum fields the renderer needs (slug + name/species + level); the rest
 * is filled in lazily by `normalizeCharacterSheet` / `normalizeTrainerSheet`
 * when the editor mounts.
 *
 * Request body:
 *   {
 *     kind:    'pokemon' | 'trainer',
 *     folder?: string,        // path under the root, '' for root
 *   }
 *
 * Response: `{ ok: true, kind, slug, path }`
 *
 * Local dev tool only: refuses to run when `NODE_ENV === 'production'`.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath, join as joinPath, sep } from 'node:path'
import { defineEventHandler, readBody, createError } from 'h3'
import { publishRealtime } from '../../utils/realtime'

interface CreateSheetBody {
  kind?: 'pokemon' | 'trainer'
  folder?: string
  clientId?: string
}

const PROJECT_ROOT = resolvePath(process.cwd())
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/

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

/** Walk `root` recursively and return true if any file is named `${slug}.json`. */
const slugExists = (root: string, slug: string): boolean => {
  const target = `${slug}.json`
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
      else if (entry.isFile() && entry.name === target) return true
    }
  }
  return false
}

const allocateSlug = (root: string, kind: 'pokemon' | 'trainer'): string => {
  const base = kind === 'pokemon' ? 'new-pokemon' : 'new-trainer'
  if (!slugExists(root, base)) return base
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base}-${i}`
    if (!slugExists(root, candidate)) return candidate
  }
  throw createError({ statusCode: 500, statusMessage: 'Could not allocate a free slug' })
}

const buildPokemonSheet = (slug: string) => ({
  slug,
  nickname: 'New Pokémon',
  species: 'Bulbasaur',
  level: 1,
})

const buildTrainerSheet = (slug: string) => ({
  slug,
  name: 'New Trainer',
  level: 1,
})

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 403, statusMessage: 'Disabled in production' })
  }

  const body = await readBody<CreateSheetBody>(event)
  if (body?.kind !== 'pokemon' && body?.kind !== 'trainer') {
    throw createError({ statusCode: 400, statusMessage: 'kind must be "pokemon" or "trainer"' })
  }
  const folder = sanitizeFolder(String(body?.folder ?? ''))

  const root = resolvePath(
    PROJECT_ROOT,
    body.kind === 'pokemon' ? 'data/sheets' : 'data/trainers',
  )
  const destDir = folder ? joinPath(root, folder) : root
  if (destDir !== root && !destDir.startsWith(root + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid destination' })
  }

  const slug = allocateSlug(root, body.kind)
  const sheet = body.kind === 'pokemon' ? buildPokemonSheet(slug) : buildTrainerSheet(slug)
  const filePath = joinPath(destDir, `${slug}.json`)

  mkdirSync(destDir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(sheet, null, 2) + '\n', 'utf8')

  publishRealtime({
    channel: 'sheets',
    type: 'updated',
    clientId: body.clientId,
    data: { kind: body.kind, slug, sheet: { ...sheet, folder } },
  })

  return {
    ok: true as const,
    kind: body.kind,
    slug,
    path: filePath.slice(PROJECT_ROOT.length + 1),
  }
})
