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
} from 'node:fs'
import { resolve, sep } from 'node:path'
import type { MapSummary, TabletopMap } from '~/types/map'
import {
  SAFE_FOLDER_SEGMENT_RE,
  SLUG_RE as SHARED_SLUG_RE,
  sanitizeFolderPath as sanitizeSharedFolderPath,
  slugify as sharedSlugify,
} from '~/shared/paths'
import { toPersistableMapPayload } from '~/utils/maps/persistence'
import { PROJECT_ROOT, pruneEmptyParents } from './fsPaths'
import {
  findFileByName,
  walkDirectories,
  walkFiles,
  writeJsonFile,
} from './jsonFiles'
import { normalizeMapDocument } from './mapNormalization'

export const MAPS_ROOT = resolve(PROJECT_ROOT, 'data/maps')
export const SLUG_RE = SHARED_SLUG_RE
export const SAFE_SEGMENT = SAFE_FOLDER_SEGMENT_RE

export const ensureMapsRoot = (): void => {
  if (!existsSync(MAPS_ROOT)) mkdirSync(MAPS_ROOT, { recursive: true })
}

/** Walk `data/maps/` recursively, return the first `<slug>.json` match. */
export const findMapFile = (slug: string): string | null =>
  findFileByName(MAPS_ROOT, `${slug}.json`)

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

const parseMapJsonFile = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch (err) {
    invalidMapDocument(filePath, `could not parse JSON: ${(err as Error).message}`)
  }
}

const normalizeMapFileDocument = (json: unknown, filePath: string): TabletopMap =>
  normalizeMapDocument(json, {
    sourceLabel: mapPathLabel(filePath),
    folder: folderFromPath(filePath),
  })

export const readMapFile = (filePath: string): TabletopMap =>
  normalizeMapFileDocument(parseMapJsonFile(filePath), filePath)

export const writeMapFile = (filePath: string, map: TabletopMap): void => {
  writeJsonFile(filePath, toPersistableMapPayload(map))
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
  const out: MapSummary[] = []
  for (const full of walkFiles(MAPS_ROOT, (entry) => entry.name.endsWith('.json'))) {
    try {
      const map = normalizeMapFileDocument(parseMapJsonFile(full), full)
      out.push(summarizeMap(map))
    } catch (err) {
      console.warn('[maps] failed to read', full, err)
    }
  }
  return out.sort((a, b) => {
    const folderCmp = a.folder.localeCompare(b.folder)
    if (folderCmp !== 0) return folderCmp
    return a.name.localeCompare(b.name)
  })
}

export const listMapFolders = (): string[] =>
  walkDirectories(MAPS_ROOT).sort((a, b) => a.localeCompare(b))

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
