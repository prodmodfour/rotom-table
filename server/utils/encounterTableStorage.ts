import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { SAFE_FOLDER_SEGMENT_RE, slugify as sharedSlugify } from '#shared/paths'
import type { EncounterTable, EncounterTableEntry } from '~/types/encounterTable'
import {
  joinSafeUnderRoot,
  PROJECT_ROOT,
  pruneEmptyParents,
  relativeToProjectRoot,
  sanitizeFolderPath,
} from './fsPaths'
import { walkDirectories, walkFiles, writeJsonFile } from './jsonFiles'

export const ENCOUNTER_TABLES_ROOT = resolve(PROJECT_ROOT, 'encounter_tables')

export interface EncounterTableStorageResult {
  entry: EncounterTableEntry
  path: string
}

export interface EncounterFolderStorageResult {
  path: string
  folder: string
  created?: boolean
}

export interface EncounterFolderMoveResult {
  moved: boolean
}

export interface EncounterFolderDeleteResult {
  removed: string
}

export const DEFAULT_ENCOUNTER_TABLE_NAME = 'Untitled Encounter Table'

export const defaultEncounterTable = (name = DEFAULT_ENCOUNTER_TABLE_NAME): EncounterTable => ({
  name,
  min_level: 1,
  max_level: 5,
  entries: [{ weight: 1, species: 'Pidgey', min_level: 1, max_level: 5 }],
})

export const ensureEncounterTablesRoot = (root = ENCOUNTER_TABLES_ROOT): void => {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
}

export const sanitizeEncounterTableFolderPath = (path: string, allowEmpty = false): string =>
  sanitizeFolderPath(path, { allowEmpty })

export const sanitizeEncounterTableKey = (value: unknown, label = 'key'): string => {
  const key = String(value ?? '').trim()
  if (!SAFE_FOLDER_SEGMENT_RE.test(key)) {
    throw new Error(`${label} segment "${key}" must match /^[A-Za-z0-9_-]+$/`)
  }
  return key
}

export const encounterTablePath = (
  root: string,
  folder: string,
  key: string,
): string => joinSafeUnderRoot(root, folder, `${key}.json`)

export const encounterTableFolderFromPath = (
  filePath: string,
  root = ENCOUNTER_TABLES_ROOT,
): string => {
  const rel = relative(root, dirname(filePath)).split(sep).join('/')
  return rel === '.' ? '' : rel
}

export const encounterTableKeyFromPath = (filePath: string): string =>
  basename(filePath).replace(/\.json$/i, '')

export const encounterTablePathLabel = (filePath: string): string =>
  filePath.startsWith(PROJECT_ROOT + sep) ? filePath.slice(PROJECT_ROOT.length + 1) : filePath

const readEncounterTableJsonFile = (filePath: string): EncounterTable =>
  JSON.parse(readFileSync(filePath, 'utf8')) as EncounterTable

export const readEncounterTableStorageFile = (
  folder: string,
  key: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult | null => {
  const filePath = encounterTablePath(root, folder, key)
  if (!existsSync(filePath)) return null
  return {
    entry: {
      region: folder,
      key,
      table: readEncounterTableJsonFile(filePath),
    },
    path: relativeToProjectRoot(filePath),
  }
}

export const sortEncounterTableEntries = (
  entries: EncounterTableEntry[],
): EncounterTableEntry[] => entries.sort((a, b) => {
  const folderCmp = a.region.localeCompare(b.region)
  if (folderCmp !== 0) return folderCmp
  return a.key.localeCompare(b.key)
})

export const listEncounterTableEntries = (
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableEntry[] => {
  const entries: EncounterTableEntry[] = []
  for (const full of walkFiles(root, (entry) => entry.name.endsWith('.json'))) {
    try {
      entries.push({
        region: encounterTableFolderFromPath(full, root),
        key: encounterTableKeyFromPath(full),
        table: readEncounterTableJsonFile(full),
      })
    } catch (err) {
      console.warn('[encounters] failed to read', encounterTablePathLabel(full), err)
    }
  }
  return sortEncounterTableEntries(entries)
}

export const listEncounterTableFolders = (root = ENCOUNTER_TABLES_ROOT): string[] =>
  walkDirectories(root).sort((a, b) => a.localeCompare(b))

export const encounterTableFileExists = (
  root: string,
  folder: string,
  key: string,
): boolean => existsSync(encounterTablePath(root, folder, key))

export const allocateEncounterTableKey = (
  name: string,
  folder: string,
  root = ENCOUNTER_TABLES_ROOT,
): string => {
  const base = sharedSlugify(name) || 'untitled-encounter-table'
  if (!encounterTableFileExists(root, folder, base)) return base

  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base}-${i}`
    if (!encounterTableFileExists(root, folder, candidate)) return candidate
  }
  throw new Error('could not allocate encounter table key')
}

export const createEncounterTableFile = (
  folder: string,
  name = DEFAULT_ENCOUNTER_TABLE_NAME,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult => {
  ensureEncounterTablesRoot(root)
  const key = allocateEncounterTableKey(name, folder, root)
  const filePath = encounterTablePath(root, folder, key)
  const table = defaultEncounterTable(name)
  writeJsonFile(filePath, table)
  return {
    entry: { region: folder, key, table },
    path: relativeToProjectRoot(filePath),
  }
}

export const createEncounterTableFolder = (
  folder: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterFolderStorageResult => {
  const destination = joinSafeUnderRoot(root, folder)
  const existed = existsSync(destination)
  mkdirSync(destination, { recursive: true })
  return {
    created: !existed,
    path: relativeToProjectRoot(destination),
    folder,
  }
}

export const moveEncounterTableFile = (
  fromFolder: string,
  key: string,
  toFolder: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult | null => {
  const sourcePath = encounterTablePath(root, fromFolder, key)
  if (!existsSync(sourcePath)) return null

  const destinationPath = encounterTablePath(root, toFolder, key)
  if (sourcePath !== destinationPath) {
    if (existsSync(destinationPath)) {
      throw new Error('An encounter table with that key already exists in the target folder')
    }
    mkdirSync(dirname(destinationPath), { recursive: true })
    renameSync(sourcePath, destinationPath)
    pruneEmptyParents(sourcePath, root)
  }

  return {
    entry: { region: toFolder, key, table: readEncounterTableJsonFile(destinationPath) },
    path: relativeToProjectRoot(destinationPath),
  }
}

export const writeEncounterTableStorageFile = (
  folder: string,
  key: string,
  table: EncounterTable,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult | null => {
  const filePath = encounterTablePath(root, folder, key)
  if (!existsSync(filePath)) return null
  writeJsonFile(filePath, table)
  return {
    entry: { region: folder, key, table },
    path: relativeToProjectRoot(filePath),
  }
}

export const renameEncounterTableFile = (
  folder: string,
  key: string,
  name: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult | null => {
  const sourcePath = encounterTablePath(root, folder, key)
  if (!existsSync(sourcePath)) return null

  const table = readEncounterTableJsonFile(sourcePath)
  const desiredKey = sharedSlugify(name)
  let nextKey = key
  let destinationPath = sourcePath

  if (desiredKey && desiredKey !== key) {
    nextKey = encounterTableFileExists(root, folder, desiredKey)
      ? allocateEncounterTableKey(name, folder, root)
      : desiredKey
    destinationPath = encounterTablePath(root, folder, nextKey)
    if (existsSync(destinationPath)) {
      throw new Error(`Encounter table ${nextKey}.json already exists`)
    }
    renameSync(sourcePath, destinationPath)
  }

  table.name = name
  writeJsonFile(destinationPath, table)

  return {
    entry: { region: folder, key: nextKey, table },
    path: relativeToProjectRoot(destinationPath),
  }
}

export const deleteEncounterTableFile = (
  folder: string,
  key: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterTableStorageResult | null => {
  const filePath = encounterTablePath(root, folder, key)
  if (!existsSync(filePath)) return null
  const table = readEncounterTableJsonFile(filePath)
  unlinkSync(filePath)
  pruneEmptyParents(filePath, root)
  return {
    entry: { region: folder, key, table },
    path: relativeToProjectRoot(filePath),
  }
}

export const moveEncounterTableFolder = (
  from: string,
  to: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterFolderMoveResult | null => {
  if (from === to) return { moved: false }
  if (to.startsWith(`${from}/`)) {
    throw new Error('Cannot move a folder into itself or one of its descendants')
  }

  const source = joinSafeUnderRoot(root, from)
  const destination = joinSafeUnderRoot(root, to)
  if (!existsSync(source) || !statSync(source).isDirectory()) return null
  if (existsSync(destination)) throw new Error('Destination folder already exists')

  mkdirSync(dirname(destination), { recursive: true })
  renameSync(source, destination)
  pruneEmptyParents(source, root)

  return { moved: true }
}

export const deleteEncounterTableFolder = (
  folder: string,
  root = ENCOUNTER_TABLES_ROOT,
): EncounterFolderDeleteResult | null => {
  const resolvedRoot = resolve(root)
  const dir = joinSafeUnderRoot(resolvedRoot, folder)
  if (dir === resolvedRoot) throw new Error('Invalid folder path')
  if (!existsSync(dir)) return null
  if (!statSync(dir).isDirectory()) throw new Error('Not a directory')

  rmSync(dir, { recursive: true, force: true })
  pruneEmptyParents(dir, resolvedRoot)

  return { removed: relativeToProjectRoot(dir) }
}

export const pruneEmptyEncounterTableParents = (path: string, root = ENCOUNTER_TABLES_ROOT): void => {
  pruneEmptyParents(path, root)
}
