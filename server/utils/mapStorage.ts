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
import type { GridDimensions, MapSummary, MapVoxelV2, TabletopMap, TabletopMapV2 } from '~/types/map'
import { normalizeMaterialId } from '~/utils/mapMaterials'

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

const mapPathLabel = (filePath: string): string =>
  filePath.startsWith(PROJECT_ROOT + sep) ? filePath.slice(PROJECT_ROOT.length + 1) : filePath

const invalidMapDocument = (filePath: string, message: string): never => {
  throw new Error(`Map ${mapPathLabel(filePath)} is invalid: ${message}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeMapDimensionsForEditor = (value: unknown, filePath: string): GridDimensions => {
  if (!isRecord(value)) invalidMapDocument(filePath, 'dimensions must be an object with integer x/y/z values')
  const out = {} as GridDimensions
  for (const axis of ['x', 'y', 'z'] as const) {
    const n = value[axis]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 200) {
      invalidMapDocument(filePath, `dimensions.${axis} must be an integer 1..200`)
    }
    out[axis] = n
  }
  return out
}

export const normalizeMapGroundLevelY = (value: unknown, height: number): number => {
  const h = Number(height)
  const max = Number.isFinite(h) ? Math.max(0, Math.floor(h) - 1) : 0
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

const normalizeVoxelForEditor = (value: unknown, index: number, filePath: string): MapVoxelV2 => {
  if (!isRecord(value)) invalidMapDocument(filePath, `voxels[${index}] must be an object`)
  for (const axis of ['x', 'y', 'z'] as const) {
    if (typeof value[axis] !== 'number' || !Number.isInteger(value[axis])) invalidMapDocument(filePath, `voxels[${index}].${axis} must be an integer`)
  }
  if (typeof value.materialId !== 'string' || !value.materialId.trim()) {
    invalidMapDocument(filePath, `voxels[${index}].materialId must be a non-empty string`)
  }
  const out: MapVoxelV2 = {
    x: value.x as number,
    y: value.y as number,
    z: value.z as number,
    materialId: normalizeMaterialId(value.materialId),
  }
  if (typeof value.color === 'string') out.color = value.color
  if (typeof value.blocksMovement === 'boolean') out.blocksMovement = value.blocksMovement
  if (typeof value.blocksSight === 'boolean') out.blocksSight = value.blocksSight
  if (Array.isArray(value.tags)) out.tags = value.tags.filter((tag): tag is string => typeof tag === 'string')
  return out
}

const normalizeMapDocument = (json: TabletopMapV2, filePath: string): TabletopMapV2 => {
  if (!isRecord(json)) invalidMapDocument(filePath, 'root must be an object')
  if (json.schemaVersion !== 2) invalidMapDocument(filePath, 'schemaVersion must be 2')
  if (!SLUG_RE.test(String(json.slug ?? ''))) invalidMapDocument(filePath, 'slug must match /^[a-z0-9-]+$/')
  if (typeof json.name !== 'string' || !json.name.trim()) invalidMapDocument(filePath, 'name must be a non-empty string')
  const dimensions = normalizeMapDimensionsForEditor(json.dimensions, filePath)

  const initiative = json.initiative && typeof json.initiative === 'object'
    ? json.initiative
    : { activeId: null, round: 1 }

  if (!Array.isArray(json.voxels)) invalidMapDocument(filePath, 'voxels must be an array')
  const voxels = json.voxels
    .map((voxel, index) => normalizeVoxelForEditor(voxel, index, filePath))

  return {
    schemaVersion: 2,
    slug: json.slug,
    name: json.name,
    folder: json.folder ?? folderFromPath(filePath),
    dimensions,
    groundLevelY: normalizeMapGroundLevelY(json.groundLevelY, dimensions.y),
    voxels,
    placements: Array.isArray(json.placements) ? json.placements : [],
    lights: Array.isArray(json.lights) ? json.lights : [],
    initiative,
    metadata: json.metadata,
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  }
}

export const readMapFile = (filePath: string): TabletopMap => {
  const raw = readFileSync(filePath, 'utf8')
  let json: TabletopMapV2
  try {
    json = JSON.parse(raw) as TabletopMapV2
  } catch (err) {
    invalidMapDocument(filePath, `could not parse JSON: ${(err as Error).message}`)
  }
  return normalizeMapDocument(json, filePath)
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
          const raw = JSON.parse(readFileSync(full, 'utf8')) as TabletopMapV2
          const map = normalizeMapDocument(raw, full)
          out.push({
            slug: map.slug,
            name: map.name,
            folder: map.folder ?? rel,
            dimensions: map.dimensions,
            placementCount: map.placements?.length ?? 0,
            schemaVersion: map.schemaVersion,
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
