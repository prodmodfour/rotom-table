/**
 * Filesystem helpers for map documents.
 *
 * Maps live as JSON files under ``data/maps/`` (recursively). The
 * directory layout mirrors the sheet system so the same folder /
 * drag-drop UX can be reused.
 */
import { readFileSync } from 'node:fs'
import type { MapSummary, TabletopMap } from '~/types/map'
import { toPersistableMapPayload } from '~/utils/maps/persistence'
import {
  findFileByName,
  walkDirectories,
  walkFiles,
  writeJsonFile,
} from './jsonFiles'
import { normalizeMapDocument } from './mapNormalization'
import {
  MAPS_ROOT,
  folderFromPath,
  mapPathLabel,
  slugify as slugifyMapBase,
} from './mapPaths'
import { summarizeMap, sortMapSummaries } from './mapSummaries'

/** Walk `data/maps/` recursively, return the first `<slug>.json` match. */
export const findMapFile = (slug: string): string | null =>
  findFileByName(MAPS_ROOT, `${slug}.json`)

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
  return sortMapSummaries(out)
}

export const listMapFolders = (): string[] =>
  walkDirectories(MAPS_ROOT).sort((a, b) => a.localeCompare(b))

export const allocateSlug = (base: string): string => {
  const root = slugifyMapBase(base) || 'untitled-map'
  if (!findMapFile(root)) return root
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${root}-${i}`
    if (!findMapFile(candidate)) return candidate
  }
  throw new Error('could not allocate slug')
}
