import { readFileSync } from 'node:fs'
import { dirname, relative, sep } from 'node:path'
import type { TabletopMap } from '~/types/map'
import { normalizeMapDocument } from '../utils/mapNormalization'
import { MAPS_ROOT, mapPathLabel } from '../utils/mapPaths'
import { walkFiles, type FilePredicate } from '../utils/jsonFiles'
import { sqliteMapRepository, type MapRepository } from './mapRepository'

export interface ImportedMapFromJson {
  readonly slug: string
  readonly folder: string
  readonly revision: number
  readonly updatedAt?: number
  readonly sourcePath: string
}

export interface ImportMapsFromJsonResult {
  readonly mapsRoot: string
  readonly imported: readonly ImportedMapFromJson[]
  readonly count: number
}

export interface ImportMapsFromJsonOptions {
  readonly mapsRoot?: string
  readonly repository?: Pick<MapRepository, 'saveSetupMap'>
  readonly listFiles?: (root: string, predicate?: FilePredicate) => string[]
  readonly readFile?: (path: string) => string
}

const isJsonMapFile: FilePredicate = (entry) => entry.name.endsWith('.json')

const folderFromRoot = (root: string, filePath: string): string => {
  const directory = dirname(relative(root, filePath)).split(sep).join('/')
  return directory === '.' ? '' : directory
}

const parseMapJson = (path: string, readFile: (path: string) => string): unknown => {
  try {
    return JSON.parse(readFile(path)) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Map ${mapPathLabel(path)} could not be imported: ${message}`)
  }
}

const normalizeImportedMap = (
  path: string,
  root: string,
  readFile: (path: string) => string,
): TabletopMap => normalizeMapDocument(parseMapJson(path, readFile), {
  sourceLabel: mapPathLabel(path),
  folder: folderFromRoot(root, path),
})

export const listJsonMapImportFiles = (
  root: string = MAPS_ROOT,
  listFiles: (root: string, predicate?: FilePredicate) => string[] = walkFiles,
): string[] => listFiles(root, isJsonMapFile).sort((left, right) => left.localeCompare(right))

export const importMapsFromJson = async (
  options: ImportMapsFromJsonOptions = {},
): Promise<ImportMapsFromJsonResult> => {
  const mapsRoot = options.mapsRoot ?? MAPS_ROOT
  const repository = options.repository ?? sqliteMapRepository
  const listFiles = options.listFiles ?? walkFiles
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const imported: ImportedMapFromJson[] = []

  for (const path of listJsonMapImportFiles(mapsRoot, listFiles)) {
    const map = normalizeImportedMap(path, mapsRoot, readFile)
    const saved = repository.saveSetupMap(map)
    imported.push({
      slug: saved.slug,
      folder: saved.folder ?? '',
      revision: saved.revision ?? 0,
      updatedAt: saved.updatedAt,
      sourcePath: path,
    })
  }

  return {
    mapsRoot,
    imported,
    count: imported.length,
  }
}
