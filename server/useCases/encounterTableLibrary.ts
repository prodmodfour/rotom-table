import {
  clampEncounterLevel,
  isNormalizedEncounterNothingEntry,
  normalizeEncounterLevelRange,
  normalizeEncounterTableRollEntriesWithDefaultNothing,
  serializeEncounterTableRollEntry,
} from '#shared/encounterTables'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  createEncounterTableFile,
  createEncounterTableFolder,
  deleteEncounterTableFile,
  deleteEncounterTableFolder,
  listEncounterTableEntries,
  listEncounterTableFolders,
  moveEncounterTableFile,
  moveEncounterTableFolder,
  renameEncounterTableFile,
  sanitizeEncounterTableFolderPath,
  writeEncounterTableStorageFile,
  sanitizeEncounterTableKey,
  type EncounterFolderDeleteResult,
  type EncounterFolderMoveResult,
  type EncounterFolderStorageResult,
  type EncounterTableStorageResult,
} from '../utils/encounterTableStorage'
import type { EncounterTable, EncounterTableEntry } from '~/types/encounterTable'

export class EncounterTableLibraryUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface ListEncounterTablesResult {
  tables: EncounterTableEntry[]
}

export interface ListEncounterTableFoldersResult {
  folders: string[]
}

export interface CreateEncounterTableInput {
  folder?: unknown
  name?: unknown
}

export interface CreateEncounterTableFolderInput {
  folder?: unknown
}

export interface MoveEncounterTableInput {
  region?: unknown
  key?: unknown
  folder?: unknown
}

export interface MoveEncounterTableFolderInput {
  from?: unknown
  to?: unknown
}

export interface RenameEncounterTableInput {
  region?: unknown
  key?: unknown
  name?: unknown
}

export interface SaveEncounterTableInput {
  region?: unknown
  key?: unknown
  table?: unknown
}

export interface DeleteEncounterTableInput {
  region?: unknown
  key?: unknown
}

export interface DeleteEncounterTableFolderInput {
  folder?: unknown
}

export interface EncounterTableMutationResult {
  ok: true
  entry: EncounterTableEntry
  path: string
}

export interface EncounterTableFolderCreateResult {
  ok: true
  created: boolean
  path: string
  folder: string
}

export interface EncounterTableFolderMoveResult {
  ok: true
  moved: boolean
}

export interface EncounterTableFolderDeleteResult {
  ok: true
  removed: string
}

export interface EncounterTableLibraryDependencies {
  listTables?: () => EncounterTableEntry[]
  listFolders?: () => string[]
  createTable?: (folder: string, name: string) => EncounterTableStorageResult
  createFolder?: (folder: string) => EncounterFolderStorageResult
  moveTable?: (fromFolder: string, key: string, toFolder: string) => EncounterTableStorageResult | null
  moveFolder?: (from: string, to: string) => EncounterFolderMoveResult | null
  renameTable?: (folder: string, key: string, name: string) => EncounterTableStorageResult | null
  saveTable?: (folder: string, key: string, table: EncounterTable) => EncounterTableStorageResult | null
  deleteTable?: (folder: string, key: string) => EncounterTableStorageResult | null
  deleteFolder?: (folder: string) => EncounterFolderDeleteResult | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  sanitizeKey?: (key: unknown, label?: string) => string
}

const MAX_ENCOUNTER_TABLE_NAME_LENGTH = 80

const normalizeStorageError = (
  err: unknown,
  fallbackStatus: 400 | 409 = 400,
): EncounterTableLibraryUseCaseError => {
  const message = (err as Error).message
  if (message === 'Destination folder already exists') {
    return new EncounterTableLibraryUseCaseError(409, message)
  }
  if (message.includes('already exists')) {
    return new EncounterTableLibraryUseCaseError(409, message)
  }
  if (message === 'Invalid path: outside root') {
    return new EncounterTableLibraryUseCaseError(400, 'Invalid path')
  }
  return new EncounterTableLibraryUseCaseError(fallbackStatus, message)
}

export const normalizeEncounterTableFolder = (
  value: unknown,
  options: { allowEmpty: boolean; label?: string },
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeEncounterTableFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), options.allowEmpty)
  } catch (err) {
    const label = options.label ?? 'folder'
    const message = (err as Error).message.replace(/^folder\b/, label)
    throw new EncounterTableLibraryUseCaseError(400, message)
  }
}

export const normalizeEncounterTableKey = (
  value: unknown,
  sanitizeKey: (key: unknown, label?: string) => string = sanitizeEncounterTableKey,
): string => {
  try {
    return sanitizeKey(value, 'key')
  } catch (err) {
    throw new EncounterTableLibraryUseCaseError(400, (err as Error).message)
  }
}

export const normalizeEncounterTableName = (value: unknown): string => {
  const name = String(value ?? '').trim() || 'Untitled Encounter Table'
  if (name.length > MAX_ENCOUNTER_TABLE_NAME_LENGTH) {
    throw new EncounterTableLibraryUseCaseError(400, 'name too long (max 80 chars)')
  }
  return name
}

const recordFromUnknown = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EncounterTableLibraryUseCaseError(400, `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export const normalizeEncounterTableForSave = (value: unknown): EncounterTable => {
  const table = recordFromUnknown(value, 'table')
  const name = normalizeEncounterTableName(table.name)
  const fallback = normalizeEncounterLevelRange(table.min_level, table.max_level, {
    min_level: 1,
    max_level: 5,
  })
  const rawEntries = table.entries
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new EncounterTableLibraryUseCaseError(400, 'table.entries must contain at least one row')
  }

  const normalizedEntries = normalizeEncounterTableRollEntriesWithDefaultNothing(rawEntries, fallback)
  const nothingEntries = normalizedEntries.filter(isNormalizedEncounterNothingEntry)
  const pokemonEntries = normalizedEntries.filter((entry) => !isNormalizedEncounterNothingEntry(entry))
  if (nothingEntries.length > 1) {
    throw new EncounterTableLibraryUseCaseError(400, 'Only one Nothing row is allowed')
  }
  if (pokemonEntries.length === 0) {
    throw new EncounterTableLibraryUseCaseError(400, 'table.entries must contain at least one Pokémon row')
  }

  const entries = normalizedEntries.map((entry, index) => {
    if (!entry.species) {
      throw new EncounterTableLibraryUseCaseError(400, `Row ${index + 1}: species is required`)
    }
    if (!Number.isInteger(entry.weight) || entry.weight < 1) {
      throw new EncounterTableLibraryUseCaseError(400, `Row ${index + 1}: weight must be a positive integer`)
    }
    return serializeEncounterTableRollEntry(entry)
  })

  return {
    name,
    min_level: Math.min(...pokemonEntries.map((entry) => clampEncounterLevel(entry.min_level))),
    max_level: Math.max(...pokemonEntries.map((entry) => clampEncounterLevel(entry.max_level))),
    entries,
  }
}

export const listEncounterTablesUseCase = (
  dependencies: EncounterTableLibraryDependencies = {},
): ListEncounterTablesResult => ({
  tables: (dependencies.listTables ?? listEncounterTableEntries)(),
})

export const listEncounterTableFoldersUseCase = (
  dependencies: EncounterTableLibraryDependencies = {},
): ListEncounterTableFoldersResult => ({
  folders: (dependencies.listFolders ?? listEncounterTableFolders)(),
})

export const createEncounterTableUseCase = (
  input: CreateEncounterTableInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableMutationResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const createTable = dependencies.createTable ?? createEncounterTableFile
  const folder = normalizeEncounterTableFolder(input.folder, { allowEmpty: true }, sanitizeFolder)
  const name = normalizeEncounterTableName(input.name)

  try {
    const result = createTable(folder, name)
    return { ok: true, entry: result.entry, path: result.path }
  } catch (err) {
    throw normalizeStorageError(err)
  }
}

export const createEncounterTableFolderUseCase = (
  input: CreateEncounterTableFolderInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableFolderCreateResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const createFolder = dependencies.createFolder ?? createEncounterTableFolder
  const folder = normalizeEncounterTableFolder(input.folder, { allowEmpty: false }, sanitizeFolder)

  try {
    const result = createFolder(folder)
    return {
      ok: true,
      created: result.created ?? false,
      path: result.path,
      folder: result.folder,
    }
  } catch (err) {
    throw normalizeStorageError(err)
  }
}

export const moveEncounterTableUseCase = (
  input: MoveEncounterTableInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableMutationResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const sanitizeKey = dependencies.sanitizeKey ?? sanitizeEncounterTableKey
  const moveTable = dependencies.moveTable ?? moveEncounterTableFile
  const fromFolder = normalizeEncounterTableFolder(input.region, { allowEmpty: true, label: 'region' }, sanitizeFolder)
  const toFolder = normalizeEncounterTableFolder(input.folder, { allowEmpty: true }, sanitizeFolder)
  const key = normalizeEncounterTableKey(input.key, sanitizeKey)

  try {
    const result = moveTable(fromFolder, key, toFolder)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Encounter table ${fromFolder}/${key}.json not found`)
    return { ok: true, entry: result.entry, path: result.path }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}

export const moveEncounterTableFolderUseCase = (
  input: MoveEncounterTableFolderInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableFolderMoveResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const moveFolder = dependencies.moveFolder ?? moveEncounterTableFolder
  const from = normalizeEncounterTableFolder(input.from, { allowEmpty: false, label: 'from' }, sanitizeFolder)
  const to = normalizeEncounterTableFolder(input.to, { allowEmpty: false, label: 'to' }, sanitizeFolder)

  if (from === to) return { ok: true, moved: false }
  if (to.startsWith(`${from}/`)) {
    throw new EncounterTableLibraryUseCaseError(400, 'Cannot move a folder into itself or one of its descendants')
  }

  try {
    const result = moveFolder(from, to)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Folder "${from}" not found`)
    return { ok: true, moved: result.moved }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}

export const renameEncounterTableUseCase = (
  input: RenameEncounterTableInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableMutationResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const sanitizeKey = dependencies.sanitizeKey ?? sanitizeEncounterTableKey
  const renameTable = dependencies.renameTable ?? renameEncounterTableFile
  const folder = normalizeEncounterTableFolder(input.region, { allowEmpty: true, label: 'region' }, sanitizeFolder)
  const key = normalizeEncounterTableKey(input.key, sanitizeKey)
  const name = normalizeEncounterTableName(input.name)

  try {
    const result = renameTable(folder, key, name)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Encounter table ${folder}/${key}.json not found`)
    return { ok: true, entry: result.entry, path: result.path }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}

export const saveEncounterTableUseCase = (
  input: SaveEncounterTableInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableMutationResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const sanitizeKey = dependencies.sanitizeKey ?? sanitizeEncounterTableKey
  const saveTable = dependencies.saveTable ?? writeEncounterTableStorageFile
  const folder = normalizeEncounterTableFolder(input.region, { allowEmpty: true, label: 'region' }, sanitizeFolder)
  const key = normalizeEncounterTableKey(input.key, sanitizeKey)
  const table = normalizeEncounterTableForSave(input.table)

  try {
    const result = saveTable(folder, key, table)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Encounter table ${folder}/${key}.json not found`)
    return { ok: true, entry: result.entry, path: result.path }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}

export const deleteEncounterTableUseCase = (
  input: DeleteEncounterTableInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableMutationResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const sanitizeKey = dependencies.sanitizeKey ?? sanitizeEncounterTableKey
  const deleteTable = dependencies.deleteTable ?? deleteEncounterTableFile
  const folder = normalizeEncounterTableFolder(input.region, { allowEmpty: true, label: 'region' }, sanitizeFolder)
  const key = normalizeEncounterTableKey(input.key, sanitizeKey)

  try {
    const result = deleteTable(folder, key)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Encounter table ${folder}/${key}.json not found`)
    return { ok: true, entry: result.entry, path: result.path }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}

export const deleteEncounterTableFolderUseCase = (
  input: DeleteEncounterTableFolderInput,
  dependencies: EncounterTableLibraryDependencies = {},
): EncounterTableFolderDeleteResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeEncounterTableFolderPath
  const deleteFolder = dependencies.deleteFolder ?? deleteEncounterTableFolder
  const folder = normalizeEncounterTableFolder(input.folder, { allowEmpty: false }, sanitizeFolder)

  try {
    const result = deleteFolder(folder)
    if (!result) throw new EncounterTableLibraryUseCaseError(404, `Folder "${folder}" not found`)
    return { ok: true, removed: result.removed }
  } catch (err) {
    if (err instanceof EncounterTableLibraryUseCaseError) throw err
    throw normalizeStorageError(err)
  }
}
