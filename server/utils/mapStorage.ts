/**
 * Filesystem helpers for map documents.
 *
 * Maps live as JSON files under ``data/maps/`` (recursively). The
 * directory layout mirrors the sheet system so the same folder /
 * drag-drop UX can be reused.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { MapSummary, TabletopMap } from '~/types/map'

export const PROJECT_ROOT = resolve(process.cwd())
export const MAPS_ROOT = resolve(PROJECT_ROOT, 'data/maps')
export const SLUG_RE = /^[a-z0-9-]+$/
export const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/

export const ensureMapsRoot = (): void => {
  if (!existsSync(MAPS_ROOT)) mkdirSync(MAPS_ROOT, { recursive: true })
}

/** Walk `data/maps/` recursively, return the first `<slug>.json` match. */
export const findMapFile = (slug: string): string | null => {
  if (!existsSync(MAPS_ROOT)) return null
  const stack: string[] = [MAPS_ROOT]
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
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === `${slug}.json`) return full
    }
  }
  return null
}

export const folderFromPath = (filePath: string): string => {
  const rel = filePath.slice(MAPS_ROOT.length + 1).split(sep).join('/')
  const lastSlash = rel.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rel.slice(0, lastSlash)
}

export const readMapFile = (filePath: string): TabletopMap => {
  const raw = readFileSync(filePath, 'utf8')
  const json = JSON.parse(raw) as TabletopMap
  const initiative = json.initiative && typeof json.initiative === 'object'
    ? json.initiative
    : { activeId: null, round: 1 }
  return {
    ...json,
    folder: json.folder ?? folderFromPath(filePath),
    initiative,
    voxels: Array.isArray(json.voxels) ? json.voxels : [],
  }
}

export const writeMapFile = (filePath: string, map: TabletopMap): void => {
  mkdirSync(dirname(filePath), { recursive: true })
  // Folder is re-derived from the path on read, so don't persist it.
  const out: Record<string, unknown> = { ...(map as unknown as Record<string, unknown>) }
  delete out.folder
  writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf8')
}

export const listMaps = (): MapSummary[] => {
  if (!existsSync(MAPS_ROOT)) return []
  const out: MapSummary[] = []
  const stack: Array<{ abs: string; rel: string }> = [{ abs: MAPS_ROOT, rel: '' }]
  while (stack.length) {
    const { abs, rel } = stack.pop()!
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(abs, entry.name)
      if (entry.isDirectory()) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        stack.push({ abs: full, rel: childRel })
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const map = JSON.parse(readFileSync(full, 'utf8')) as TabletopMap
          out.push({
            slug: map.slug,
            name: map.name,
            folder: map.folder ?? rel,
            dimensions: map.dimensions,
            placementCount: map.placements?.length ?? 0,
            updatedAt: map.updatedAt,
          })
        } catch (err) {
          console.warn('[maps] failed to read', full, err)
        }
      }
    }
  }
  return out.sort((a, b) => {
    const folderCmp = a.folder.localeCompare(b.folder)
    if (folderCmp !== 0) return folderCmp
    return a.name.localeCompare(b.name)
  })
}

export const listMapFolders = (): string[] => {
  if (!existsSync(MAPS_ROOT)) return []
  const out = new Set<string>()
  const stack: Array<{ abs: string; rel: string }> = [{ abs: MAPS_ROOT, rel: '' }]
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
      out.add(childRel)
      stack.push({ abs: join(abs, entry.name), rel: childRel })
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b))
}

/** Walk up from `path`, removing empty directories until we leave `MAPS_ROOT`. */
export const pruneEmptyParents = (path: string): void => {
  let parent = dirname(path)
  while (parent.startsWith(MAPS_ROOT + sep) && parent !== MAPS_ROOT) {
    try {
      if (readdirSync(parent).length > 0) break
      rmdirSync(parent)
    } catch {
      break
    }
    parent = dirname(parent)
  }
}

export const sanitizeFolderPath = (path: string, allowEmpty = false): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, '').trim()
  if (!trimmed) {
    if (allowEmpty) return ''
    throw new Error('folder must not be empty')
  }
  for (const seg of trimmed.split('/')) {
    if (!SAFE_SEGMENT.test(seg)) {
      throw new Error(`folder segment "${seg}" must match /^[A-Za-z0-9_-]+$/`)
    }
  }
  return trimmed
}

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

export const allocateSlug = (base: string): string => {
  const root = slugify(base) || 'untitled-map'
  if (!findMapFile(root)) return root
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${root}-${i}`
    if (!findMapFile(candidate)) return candidate
  }
  throw new Error('could not allocate slug')
}
