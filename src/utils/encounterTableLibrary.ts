import { normalizeEncounterTableRollEntries } from '#shared/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'
import {
  isInsideFolder,
  isSameOrDescendantFolder,
  normalizeSearchText,
  renameFolderPrefix,
} from '~/utils/folderBrowser'
import { encounterTableEntryId, formatRegionLabel } from '~/utils/encounterTables'

export interface EncounterTableLibraryCollections {
  tables: Map<string, EncounterTableEntry>
  extraFolders: Set<string>
}

export const encounterTableLibraryKey = encounterTableEntryId

export const encounterTableFolder = (entry: EncounterTableEntry): string => entry.region

export const buildEncounterTableFolderSet = (
  items: readonly EncounterTableEntry[],
  extraFolders: Iterable<string>,
): Set<string> => {
  const folders = new Set<string>()
  for (const item of items) if (item.region) folders.add(item.region)
  for (const folder of extraFolders) folders.add(folder)
  return folders
}

export const encounterTableMatchesQuery = (
  item: EncounterTableEntry,
  normalizedQuery: string,
): boolean => {
  const normalizedEntries = normalizeEncounterTableRollEntries(item.table.entries, {
    min_level: item.table.min_level,
    max_level: item.table.max_level,
  })
  const haystacks = [
    item.key,
    item.region,
    formatRegionLabel(item.region),
    item.table.name,
    ...normalizedEntries.map((entry) => entry.species),
  ]
  return haystacks.some((value) => normalizeSearchText(value).includes(normalizedQuery))
}

export const filterVisibleEncounterTables = ({
  items,
  currentPath,
  searchTerm,
}: {
  items: readonly EncounterTableEntry[]
  currentPath: string
  searchTerm: string
}): EncounterTableEntry[] => {
  const query = normalizeSearchText(searchTerm)
  const pool = items.filter((item) => isInsideFolder(item.region, currentPath))
  const matched = query ? pool.filter((item) => encounterTableMatchesQuery(item, query)) : pool
  const scoped = query ? matched : matched.filter((item) => item.region === currentPath)
  return [...scoped].sort((a, b) => a.table.name.localeCompare(b.table.name))
}

export const countFilteredEncounterTables = (
  items: ReadonlyArray<EncounterTableEntry>,
  searchTerm: string,
): number => {
  const query = normalizeSearchText(searchTerm)
  return query ? items.filter((item) => encounterTableMatchesQuery(item, query)).length : items.length
}

export const moveEncounterTableFolderInLibrary = (
  collections: EncounterTableLibraryCollections,
  from: string,
  to: string,
): void => {
  const nextFolders = new Set<string>()
  for (const folder of collections.extraFolders) {
    nextFolders.add(renameFolderPrefix(folder, from, to))
  }
  collections.extraFolders.clear()
  for (const folder of nextFolders) collections.extraFolders.add(folder)

  const nextTables = new Map<string, EncounterTableEntry>()
  for (const table of collections.tables.values()) {
    const moved = { ...table, region: renameFolderPrefix(table.region, from, to) }
    nextTables.set(encounterTableLibraryKey(moved), moved)
  }
  collections.tables.clear()
  for (const [id, table] of nextTables) collections.tables.set(id, table)
}

export const deleteEncounterTableFolderFromLibrary = (
  collections: EncounterTableLibraryCollections,
  folder: string,
): void => {
  collections.extraFolders.delete(folder)
  for (const path of [...collections.extraFolders]) {
    if (isSameOrDescendantFolder(path, folder)) collections.extraFolders.delete(path)
  }
  for (const [id, table] of [...collections.tables]) {
    if (isSameOrDescendantFolder(table.region, folder)) collections.tables.delete(id)
  }
}
