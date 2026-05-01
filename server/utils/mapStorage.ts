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
import type { GridDimensions, MapSummary, MapVoxelV2, TabletopMap, TabletopMapV1, TabletopMapV2 } from '~/types/map'
import { materialIdForLegacy, normalizeMaterialId } from '~/utils/mapMaterials'

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

const normalizeVoxelForEditor = (value: unknown, index: number, filePath: string): MapVoxelV2 => {
  if (!isRecord(value)) invalidMapDocument(filePath, `voxels[${index}] must be an object`)
  for (const axis of ['x', 'y', 'z'] as const) {
    if (typeof value[axis] !== 'number' || !Number.isInteger(value[axis])) invalidMapDocument(filePath, `voxels[${index}].${axis} must be an integer`)
  }
  const rawMaterial = typeof value.materialId === 'string' && value.materialId
    ? value.materialId
    : materialIdForLegacy(typeof value.material === 'string' ? value.material : '')
  const out: Record<string, unknown> = {
    ...value,
    materialId: normalizeMaterialId(rawMaterial),
  }
  // `material` is v1 compatibility input only. Loaded/saved maps should be
  // unambiguous v2 documents keyed by `materialId`.
  delete out.material
  return out as unknown as MapVoxelV2
}

const normalizeMapDocument = (json: TabletopMapV1 | TabletopMapV2, filePath: string): TabletopMapV2 => {
  if (!isRecord(json)) invalidMapDocument(filePath, 'root must be an object')
  if (!SLUG_RE.test(String(json.slug ?? ''))) invalidMapDocument(filePath, 'slug must match /^[a-z0-9-]+$/')
  if (typeof json.name !== 'string' || !json.name.trim()) invalidMapDocument(filePath, 'name must be a non-empty string')
  const dimensions = normalizeMapDimensionsForEditor(json.dimensions, filePath)

  const initiative = json.initiative && typeof json.initiative === 'object'
    ? json.initiative
    : { activeId: null, round: 1 }

  if (!Array.isArray(json.voxels)) invalidMapDocument(filePath, 'voxels must be an array')
  const voxels = json.voxels.map((voxel, index) => normalizeVoxelForEditor(voxel, index, filePath))

  if ((json as TabletopMapV2).schemaVersion === 2) {
    const v2 = json as TabletopMapV2
    return {
      ...v2,
      schemaVersion: 2,
      folder: v2.folder ?? folderFromPath(filePath),
      dimensions,
      initiative,
      assetPacks: Array.isArray(v2.assetPacks) ? v2.assetPacks : [],
      voxels,
      placements: Array.isArray(v2.placements) ? v2.placements : [],
      decals: Array.isArray(v2.decals) ? v2.decals : [],
      props: Array.isArray(v2.props) ? v2.props : [],
      zones: Array.isArray(v2.zones) ? v2.zones : [],
      doors: Array.isArray(v2.doors) ? v2.doors : [],
      lights: Array.isArray(v2.lights) ? v2.lights : [],
    }
  }

  // Best-effort legacy conversion: keep the map usable and make the schema
  // transition explicit in the loaded document. Saving will persist v2.
  return {
    ...(json as TabletopMapV1),
    schemaVersion: 2,
    folder: json.folder ?? folderFromPath(filePath),
    dimensions,
    initiative,
    assetPacks: [],
    voxels,
    placements: Array.isArray(json.placements) ? json.placements : [],
    decals: [],
    props: [],
    zones: [],
    doors: [],
    lights: [],
    metadata: {
      ...((json as TabletopMapV2).metadata ?? {}),
      legacySchemaConverted: true,
    },
  }
}

export const readMapFile = (filePath: string): TabletopMap => {
  const raw = readFileSync(filePath, 'utf8')
  let json: TabletopMapV1 | TabletopMapV2
  try {
    json = JSON.parse(raw) as TabletopMapV1 | TabletopMapV2
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
          const raw = JSON.parse(readFileSync(full, 'utf8')) as TabletopMapV1 | TabletopMapV2
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
