import type { FolderTile } from '~/utils/folderBrowser'
import {
  buildFolderMoveDestinations,
  canMoveFolderTo,
  folderLeafName,
  isSameOrDescendantFolder,
  joinFolderPath,
  movedFolderPath,
  parentFolderPath,
  renameFolderPrefix,
} from '~/utils/folderBrowser'
import type { EncounterTableEntry } from '~/types/encounterTable'
import {
  deleteEncounterTableFolderFromLibrary,
  encounterTableLibraryKey,
  moveEncounterTableFolderInLibrary,
} from '~/utils/encounterTableLibrary'
import { formatRegionLabel } from '~/utils/encounterTables'

interface ReadonlyValue<T> {
  readonly value: T
}

type MaybePromise<T> = T | Promise<T>

export interface EncounterTableDragTablePayload {
  type: 'table'
  id: string
  region: string
  key: string
}

export interface EncounterTableDragFolderPayload {
  type: 'folder'
  path: string
}

export type EncounterTableDragPayload = EncounterTableDragTablePayload | EncounterTableDragFolderPayload

export type EncounterTableContextTarget =
  | { type: 'table'; item: EncounterTableEntry }
  | { type: 'folder'; tile: FolderTile }

export interface UseEncounterTableLibraryActionsOptions {
  currentPath: ReadonlyValue<string>
  allFolders: ReadonlyValue<ReadonlySet<string>>
  tables: Map<string, EncounterTableEntry>
  extraFolders: Set<string>
  goToFolder: (path: string) => void
  moveTable: (payload: { region: string; key: string; folder: string }) => MaybePromise<{ entry: EncounterTableEntry } | unknown>
  moveFolder: (payload: { from: string; to: string }) => MaybePromise<unknown>
  renameTable: (payload: { region: string; key: string; name: string }) => MaybePromise<{ entry: EncounterTableEntry }>
  deleteTable: (payload: { region: string; key: string }) => MaybePromise<unknown>
  deleteFolder: (payload: { folder: string }) => MaybePromise<unknown>
}

const replaceTable = (
  tables: Map<string, EncounterTableEntry>,
  oldId: string,
  entry: EncounterTableEntry,
): void => {
  tables.delete(oldId)
  tables.set(encounterTableLibraryKey(entry), entry)
}

const updateMovedTable = (
  tables: Map<string, EncounterTableEntry>,
  payload: EncounterTableDragTablePayload,
  targetPath: string,
  result: { entry?: EncounterTableEntry } | unknown,
): void => {
  const entry = (result as { entry?: EncounterTableEntry } | null)?.entry
  if (entry) {
    replaceTable(tables, payload.id, entry)
    return
  }

  const existing = tables.get(payload.id)
  if (!existing) return
  replaceTable(tables, payload.id, { ...existing, region: targetPath })
}

export const useEncounterTableLibraryActions = (
  options: UseEncounterTableLibraryActionsOptions,
) => {
  const canDropPayloadOn = (payload: EncounterTableDragPayload, targetPath: string): boolean => {
    if (payload.type === 'table') return payload.region !== targetPath
    return canMoveFolderTo(payload.path, targetPath, options.allFolders.value)
  }

  const targetLabel = (target: EncounterTableContextTarget): string =>
    target.type === 'table' ? target.item.table.name : target.tile.label

  const renameInputForTarget = (target: EncounterTableContextTarget): string => {
    if (target.type === 'table') return target.item.table.name
    return folderLeafName(target.tile.path)
  }

  const moveDestinationsForTarget = (target: EncounterTableContextTarget) => buildFolderMoveDestinations({
    folderPaths: options.allFolders.value,
    target: target.type === 'table'
      ? { type: 'item', folder: target.item.region }
      : { type: 'folder', path: target.tile.path },
    formatLabel: formatRegionLabel,
  })

  const movePayload = async (payload: EncounterTableDragPayload, targetPath: string): Promise<void> => {
    if (payload.type === 'table') {
      const result = await options.moveTable({
        region: payload.region,
        key: payload.key,
        folder: targetPath,
      })
      updateMovedTable(options.tables, payload, targetPath, result)
      return
    }

    const newPath = movedFolderPath(payload.path, targetPath)
    await options.moveFolder({ from: payload.path, to: newPath })
    moveEncounterTableFolderInLibrary({ tables: options.tables, extraFolders: options.extraFolders }, payload.path, newPath)
  }

  const moveTarget = async (target: EncounterTableContextTarget, destination: string): Promise<void> => {
    if (target.type === 'table') {
      await movePayload({
        type: 'table',
        id: encounterTableLibraryKey(target.item),
        region: target.item.region,
        key: target.item.key,
      }, destination)
      return
    }

    await movePayload({ type: 'folder', path: target.tile.path }, destination)
  }

  const renameTarget = async (target: EncounterTableContextTarget, name: string): Promise<void> => {
    if (target.type === 'table') {
      const oldId = encounterTableLibraryKey(target.item)
      const result = await options.renameTable({
        region: target.item.region,
        key: target.item.key,
        name,
      })
      replaceTable(options.tables, oldId, result.entry)
      return
    }

    const oldPath = target.tile.path
    const parent = parentFolderPath(oldPath)
    const newPath = joinFolderPath(parent, name)
    if (newPath === oldPath) return

    await options.moveFolder({ from: oldPath, to: newPath })
    moveEncounterTableFolderInLibrary({ tables: options.tables, extraFolders: options.extraFolders }, oldPath, newPath)
    if (isSameOrDescendantFolder(options.currentPath.value, oldPath)) {
      options.goToFolder(renameFolderPrefix(options.currentPath.value, oldPath, newPath))
    }
  }

  const deleteTarget = async (target: EncounterTableContextTarget): Promise<void> => {
    if (target.type === 'table') {
      await options.deleteTable({ region: target.item.region, key: target.item.key })
      options.tables.delete(encounterTableLibraryKey(target.item))
      return
    }

    const path = target.tile.path
    await options.deleteFolder({ folder: path })
    deleteEncounterTableFolderFromLibrary({ tables: options.tables, extraFolders: options.extraFolders }, path)
    if (isSameOrDescendantFolder(options.currentPath.value, path)) {
      options.goToFolder(parentFolderPath(path))
    }
  }

  return {
    canDropPayloadOn,
    targetLabel,
    renameInputForTarget,
    moveDestinationsForTarget,
    movePayload,
    moveTarget,
    renameTarget,
    deleteTarget,
  }
}
