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
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { GridDimensions, MapHazardV2, MapSummary, MapVoxelV2, TabletopMap, TabletopMapV2 } from '~/types/map'
import {
  SAFE_FOLDER_SEGMENT_RE,
  SLUG_RE as SHARED_SLUG_RE,
  sanitizeFolderPath as sanitizeSharedFolderPath,
  slugify as sharedSlugify,
} from '~/shared/paths'
import { normalizeMaterialId } from '~/utils/mapMaterials'
import { normalizeMapHazard } from '~/utils/mapHazards'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { PROJECT_ROOT, pruneEmptyParents } from './fsPaths'

export const MAPS_ROOT = resolve(PROJECT_ROOT, 'data/maps')
export const SLUG_RE = SHARED_SLUG_RE
export const SAFE_SEGMENT = SAFE_FOLDER_SEGMENT_RE

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

const expectRecord = (value: unknown, filePath: string, message: string): Record<string, unknown> => {
  if (!isRecord(value)) invalidMapDocument(filePath, message)
  return value as Record<string, unknown>
}

const normalizeMapDimensionsForEditor = (value: unknown, filePath: string): GridDimensions => {
  const record = expectRecord(value, filePath, 'dimensions must be an object with integer x/y/z values')
  const out = {} as GridDimensions
  for (const axis of ['x', 'y', 'z'] as const) {
    const n = record[axis]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 200) {
      invalidMapDocument(filePath, `dimensions.${axis} must be an integer 1..200`)
    }
    out[axis] = n as number
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
  const record = expectRecord(value, filePath, `voxels[${index}] must be an object`)
  for (const axis of ['x', 'y', 'z'] as const) {
    if (typeof record[axis] !== 'number' || !Number.isInteger(record[axis])) invalidMapDocument(filePath, `voxels[${index}].${axis} must be an integer`)
  }
  if (typeof record.materialId !== 'string' || !record.materialId.trim()) {
    invalidMapDocument(filePath, `voxels[${index}].materialId must be a non-empty string`)
  }
  const out: MapVoxelV2 = {
    x: record.x as number,
    y: record.y as number,
    z: record.z as number,
    materialId: normalizeMaterialId(record.materialId as string),
  }
  if (typeof record.color === 'string') out.color = record.color
  if (typeof record.blocksMovement === 'boolean') out.blocksMovement = record.blocksMovement
  if (typeof record.blocksSight === 'boolean') out.blocksSight = record.blocksSight
  if (Array.isArray(record.tags)) out.tags = record.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
  return out
}

const normalizeHazardForEditor = (value: unknown, index: number, filePath: string): MapHazardV2 => {
  const hazard = normalizeMapHazard(value)
  if (!hazard) invalidMapDocument(filePath, `hazards[${index}] must be an object with integer x/y/z and valid kind`)
  return hazard as MapHazardV2
}

const normalizeMapDocument = (json: unknown, filePath: string): TabletopMapV2 => {
  const record = expectRecord(json, filePath, 'root must be an object')
  if (record.schemaVersion !== 2) invalidMapDocument(filePath, 'schemaVersion must be 2')
  if (!SLUG_RE.test(String(record.slug ?? ''))) invalidMapDocument(filePath, 'slug must match /^[a-z0-9-]+$/')
  if (typeof record.name !== 'string' || !record.name.trim()) invalidMapDocument(filePath, 'name must be a non-empty string')
  const dimensions = normalizeMapDimensionsForEditor(record.dimensions, filePath)

  const initiative = record.initiative && typeof record.initiative === 'object'
    ? record.initiative as TabletopMapV2['initiative']
    : { activeId: null, round: 1 }

  const voxelValues = Array.isArray(record.voxels)
    ? record.voxels as unknown[]
    : invalidMapDocument(filePath, 'voxels must be an array')
  const voxels = voxelValues
    .map((voxel: unknown, index: number) => normalizeVoxelForEditor(voxel, index, filePath))
  const hazards = Array.isArray(record.hazards)
    ? (record.hazards as unknown[]).map((hazard: unknown, index: number) => normalizeHazardForEditor(hazard, index, filePath))
    : []

  return {
    schemaVersion: 2,
    slug: record.slug as string,
    name: record.name as string,
    folder: typeof record.folder === 'string' ? record.folder : folderFromPath(filePath),
    dimensions,
    groundLevelY: normalizeMapGroundLevelY(record.groundLevelY, dimensions.y),
    playerVisible: record.playerVisible === true,
    voxels,
    hazards,
    fieldEffects: normalizeMapFieldEffects(record.fieldEffects),
    placements: Array.isArray(record.placements) ? record.placements as TabletopMapV2['placements'] : [],
    lights: Array.isArray(record.lights) ? record.lights as TabletopMapV2['lights'] : [],
    initiative,
    metadata: record.metadata as TabletopMapV2['metadata'],
    createdAt: record.createdAt as TabletopMapV2['createdAt'],
    updatedAt: record.updatedAt as TabletopMapV2['updatedAt'],
  }
}

export const readMapFile = (filePath: string): TabletopMap => {
  const raw = readFileSync(filePath, 'utf8')
  const parsed = (() => {
    try {
      return JSON.parse(raw) as unknown
    } catch (err) {
      invalidMapDocument(filePath, `could not parse JSON: ${(err as Error).message}`)
    }
  })()
  return normalizeMapDocument(parsed, filePath)
}

export const writeMapFile = (filePath: string, map: TabletopMap): void => {
  mkdirSync(dirname(filePath), { recursive: true })
  // Folder is re-derived from the path on read, so don't persist it.
  const out: Record<string, unknown> = { ...(map as unknown as Record<string, unknown>) }
  delete out.folder
  writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf8')
}

export const summarizeMap = (map: TabletopMap): MapSummary => ({
  slug: map.slug,
  name: map.name,
  folder: map.folder ?? '',
  dimensions: map.dimensions,
  placementCount: map.placements?.length ?? 0,
  playerVisible: map.playerVisible === true,
  schemaVersion: map.schemaVersion,
  updatedAt: map.updatedAt,
})

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
          out.push(summarizeMap({ ...map, folder: map.folder ?? rel }))
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

/** Walk up from `path`, removing empty map directories until we leave `MAPS_ROOT`. */
export const pruneEmptyMapParents = (path: string): void => {
  pruneEmptyParents(path, MAPS_ROOT)
}

export const sanitizeMapFolderPath = (path: string, allowEmpty = false): string =>
  sanitizeSharedFolderPath(path, { allowEmpty })

export const slugify = sharedSlugify

export const allocateSlug = (base: string): string => {
  const root = slugify(base) || 'untitled-map'
  if (!findMapFile(root)) return root
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${root}-${i}`
    if (!findMapFile(candidate)) return candidate
  }
  throw new Error('could not allocate slug')
}
