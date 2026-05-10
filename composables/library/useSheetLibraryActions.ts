import type { Ref } from 'vue'
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
import {
  displaySheetLibraryName,
  sheetLibraryKey,
  type SheetLibraryItem,
  type SheetLibraryKind,
} from '~/utils/sheetLibrary'

interface ReadonlyValue<T> {
  readonly value: T
}

type MaybePromise<T> = T | Promise<T>

type FolderRename = { from: string; to: string }

export interface SheetLibraryDragSheetPayload {
  type: 'sheet'
  kind: SheetLibraryKind
  slug: string
  from: string
}

export interface SheetLibraryDragFolderPayload {
  type: 'folder'
  path: string
}

export type SheetLibraryDragPayload = SheetLibraryDragSheetPayload | SheetLibraryDragFolderPayload

export type SheetLibraryContextTarget =
  | { type: 'sheet'; item: SheetLibraryItem }
  | { type: 'folder'; tile: FolderTile }

export interface UseSheetLibraryActionsOptions {
  currentPath: ReadonlyValue<string>
  allFolders: ReadonlyValue<ReadonlySet<string>>
  items: ReadonlyValue<ReadonlyArray<SheetLibraryItem>>
  extraFolders: Set<string>
  sheetOverrides: Record<string, string | undefined>
  folderRenames: Ref<FolderRename[]>
  nameOverrides: Record<string, string | undefined>
  deletedSheets: Set<string>
  deletedFolders: Set<string>
  goToFolder: (path: string) => void
  moveSheet: (payload: { kind: SheetLibraryKind; slug: string; folder: string }) => MaybePromise<unknown>
  moveFolder: (payload: { from: string; to: string }) => MaybePromise<unknown>
  renameSheet: (payload: { kind: SheetLibraryKind; slug: string; name: string }) => MaybePromise<unknown>
  deleteSheet: (payload: { kind: SheetLibraryKind; slug: string }) => MaybePromise<unknown>
  deleteFolder: (payload: { folder: string }) => MaybePromise<unknown>
}

const appendFolderRename = (folderRenames: Ref<FolderRename[]>, from: string, to: string): void => {
  folderRenames.value = [...folderRenames.value, { from, to }]
}

const deleteFolderLocally = (
  options: Pick<UseSheetLibraryActionsOptions,
    'currentPath'
    | 'items'
    | 'extraFolders'
    | 'deletedSheets'
    | 'deletedFolders'
    | 'goToFolder'
  >,
  path: string,
): void => {
  for (const item of options.items.value) {
    if (isSameOrDescendantFolder(item.folder, path)) {
      options.deletedSheets.add(sheetLibraryKey(item.kind, item.slug))
    }
  }

  options.deletedFolders.add(path)

  for (const folder of [...options.extraFolders]) {
    if (isSameOrDescendantFolder(folder, path)) options.extraFolders.delete(folder)
  }

  if (isSameOrDescendantFolder(options.currentPath.value, path)) {
    options.goToFolder(parentFolderPath(path))
  }
}

export const useSheetLibraryActions = (options: UseSheetLibraryActionsOptions) => {
  const canDropPayloadOn = (payload: SheetLibraryDragPayload, targetPath: string): boolean => {
    if (payload.type === 'sheet') return payload.from !== targetPath
    return canMoveFolderTo(payload.path, targetPath, options.allFolders.value)
  }

  const targetLabel = (target: SheetLibraryContextTarget): string =>
    target.type === 'sheet' ? displaySheetLibraryName(target.item) : target.tile.label

  const renameInputForTarget = (target: SheetLibraryContextTarget): string => {
    if (target.type === 'sheet') return displaySheetLibraryName(target.item)
    return folderLeafName(target.tile.path)
  }

  const moveDestinationsForTarget = (target: SheetLibraryContextTarget) => buildFolderMoveDestinations({
    folderPaths: options.allFolders.value,
    target: target.type === 'sheet'
      ? { type: 'item', folder: target.item.folder }
      : { type: 'folder', path: target.tile.path },
  })

  const movePayload = async (payload: SheetLibraryDragPayload, targetPath: string): Promise<void> => {
    if (payload.type === 'sheet') {
      await options.moveSheet({ kind: payload.kind, slug: payload.slug, folder: targetPath })
      options.sheetOverrides[sheetLibraryKey(payload.kind, payload.slug)] = targetPath
      return
    }

    const newPath = movedFolderPath(payload.path, targetPath)
    await options.moveFolder({ from: payload.path, to: newPath })
    appendFolderRename(options.folderRenames, payload.path, newPath)
  }

  const moveTarget = async (target: SheetLibraryContextTarget, destination: string): Promise<void> => {
    if (target.type === 'sheet') {
      await movePayload({
        type: 'sheet',
        kind: target.item.kind,
        slug: target.item.slug,
        from: target.item.folder,
      }, destination)
      return
    }

    await movePayload({ type: 'folder', path: target.tile.path }, destination)
  }

  const renameTarget = async (target: SheetLibraryContextTarget, name: string): Promise<void> => {
    if (target.type === 'sheet') {
      await options.renameSheet({ kind: target.item.kind, slug: target.item.slug, name })
      options.nameOverrides[sheetLibraryKey(target.item.kind, target.item.slug)] = name
      return
    }

    const oldPath = target.tile.path
    const parent = parentFolderPath(oldPath)
    const newPath = joinFolderPath(parent, name)
    if (newPath === oldPath) return

    await options.moveFolder({ from: oldPath, to: newPath })
    appendFolderRename(options.folderRenames, oldPath, newPath)
    if (isSameOrDescendantFolder(options.currentPath.value, oldPath)) {
      options.goToFolder(renameFolderPrefix(options.currentPath.value, oldPath, newPath))
    }
  }

  const deleteTarget = async (target: SheetLibraryContextTarget): Promise<void> => {
    if (target.type === 'sheet') {
      await options.deleteSheet({ kind: target.item.kind, slug: target.item.slug })
      options.deletedSheets.add(sheetLibraryKey(target.item.kind, target.item.slug))
      return
    }

    const path = target.tile.path
    await options.deleteFolder({ folder: path })
    deleteFolderLocally(options, path)
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
