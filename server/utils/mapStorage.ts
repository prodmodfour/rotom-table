/**
 * Filesystem helpers for map documents.
 *
 * Maps live as JSON files under ``data/maps/`` (recursively). The
 * directory layout mirrors the sheet system so the same folder /
 * drag-drop UX can be reused.
 */
import { readFileSync } from 'node:fs'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { MapSummary, SheetKind, TabletopMap } from '~/types/map'
import { toPersistableMapPayload } from '~/utils/maps/persistence'
import {
  findFileByName,
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

export interface RetargetMapSheetPlacementsResult {
  path: string
  map: TabletopMap
  placementCount: number
}

export interface RetargetMapSheetPlacementsOptions {
  now?: () => number
}

export const retargetMapSheetPlacements = (
  kind: SheetKind,
  oldSlug: string,
  newSlug: string,
  options: RetargetMapSheetPlacementsOptions = {},
): RetargetMapSheetPlacementsResult[] => {
  if (oldSlug === newSlug) return []

  const updated: RetargetMapSheetPlacementsResult[] = []
  for (const full of walkFiles(MAPS_ROOT, (entry) => entry.name.endsWith('.json'))) {
    let map: TabletopMap
    try {
      map = readMapFile(full)
    } catch (err) {
      console.warn('[maps] failed to retarget sheet placements in', full, err)
      continue
    }

    let placementCount = 0
    const placements = (map.placements ?? []).map((placement) => {
      if (placement.sheetKind !== kind || placement.sheetSlug !== oldSlug) return placement
      placementCount += 1
      return { ...placement, sheetSlug: newSlug }
    })
    if (placementCount === 0) continue

    const nextMap: TabletopMap = {
      ...map,
      revision: nextRevision(normalizeRevision(map.revision)),
      placements,
      updatedAt: options.now?.() ?? Date.now(),
    }
    writeMapFile(full, nextMap)
    updated.push({ path: full, map: nextMap, placementCount })
  }
  return updated
}

export const playerVisibleMapSheetAccessKeys = (): Set<`${SheetKind}:${string}`> => {
  const keys = new Set<`${SheetKind}:${string}`>()
  for (const full of walkFiles(MAPS_ROOT, (entry) => entry.name.endsWith('.json'))) {
    let map: TabletopMap
    try {
      map = readMapFile(full)
    } catch (err) {
      console.warn('[maps] failed to collect player-visible sheet access in', full, err)
      continue
    }

    if (map.playerVisible !== true) continue
    for (const placement of map.placements ?? []) {
      keys.add(`${placement.sheetKind}:${placement.sheetSlug}`)
    }
  }
  return keys
}

export const allocateSlug = (base: string): string => {
  const root = slugifyMapBase(base) || 'untitled-map'
  if (!findMapFile(root)) return root
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${root}-${i}`
    if (!findMapFile(candidate)) return candidate
  }
  throw new Error('could not allocate slug')
}
