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
  deleteMapFolderFromLibrary,
  moveMapFolderInLibrary,
} from '~/utils/mapLibrary'
import type { MapSummary } from '~/types/map'

interface ReadonlyValue<T> {
  readonly value: T
}

type MaybePromise<T> = T | Promise<T>

export interface MapLibraryDragMapPayload {
  type: 'map'
  slug: string
  from: string
}

export interface MapLibraryDragFolderPayload {
  type: 'folder'
  path: string
}

export type MapLibraryDragPayload = MapLibraryDragMapPayload | MapLibraryDragFolderPayload

export type MapLibraryContextTarget =
  | { type: 'map'; item: MapSummary }
  | { type: 'folder'; tile: FolderTile }

export interface UseMapLibraryActionsOptions {
  currentPath: ReadonlyValue<string>
  allFolders: ReadonlyValue<ReadonlySet<string>>
  maps: Map<string, MapSummary>
  extraFolders: Set<string>
  goToFolder: (path: string) => void
  refresh: () => MaybePromise<unknown>
  formatFolderLabel?: (path: string) => string
  moveMap: (payload: { slug: string; folder: string }) => MaybePromise<unknown>
  moveFolder: (payload: { from: string; to: string }) => MaybePromise<unknown>
  renameMap: (payload: { slug: string; name: string }) => MaybePromise<{ slug: string; name: string }>
  deleteMap: (payload: { slug: string }) => MaybePromise<unknown>
  deleteFolder: (payload: { folder: string }) => MaybePromise<unknown>
}

export const useMapLibraryActions = (options: UseMapLibraryActionsOptions) => {
  const canDropPayloadOn = (payload: MapLibraryDragPayload, targetPath: string): boolean => {
    if (payload.type === 'map') return payload.from !== targetPath
    return canMoveFolderTo(payload.path, targetPath, options.allFolders.value)
  }

  const targetLabel = (target: MapLibraryContextTarget): string =>
    target.type === 'map' ? target.item.name : target.tile.label

  const renameInputForTarget = (target: MapLibraryContextTarget): string => {
    if (target.type === 'map') return target.item.name
    return folderLeafName(target.tile.path)
  }

  const moveDestinationsForTarget = (target: MapLibraryContextTarget) => buildFolderMoveDestinations({
    folderPaths: options.allFolders.value,
    target: target.type === 'map'
      ? { type: 'item', folder: target.item.folder }
      : { type: 'folder', path: target.tile.path },
    formatLabel: options.formatFolderLabel,
  })

  const movePayload = async (payload: MapLibraryDragPayload, targetPath: string): Promise<void> => {
    if (payload.type === 'map') {
      await options.moveMap({ slug: payload.slug, folder: targetPath })
      const existing = options.maps.get(payload.slug)
      if (existing) options.maps.set(payload.slug, { ...existing, folder: targetPath })
      return
    }

    const newPath = movedFolderPath(payload.path, targetPath)
    await options.moveFolder({ from: payload.path, to: newPath })
    moveMapFolderInLibrary({ maps: options.maps, extraFolders: options.extraFolders }, payload.path, newPath)
  }

  const moveTarget = async (target: MapLibraryContextTarget, destination: string): Promise<void> => {
    if (target.type === 'map') {
      await movePayload({ type: 'map', slug: target.item.slug, from: target.item.folder }, destination)
      return
    }

    await movePayload({ type: 'folder', path: target.tile.path }, destination)
  }

  const renameTarget = async (target: MapLibraryContextTarget, name: string): Promise<void> => {
    if (target.type === 'map') {
      const result = await options.renameMap({ slug: target.item.slug, name })
      const existing = options.maps.get(target.item.slug)
      if (!existing) return

      if (result.slug === existing.slug) {
        options.maps.set(existing.slug, { ...existing, name: result.name })
      } else {
        options.maps.delete(existing.slug)
        options.maps.set(result.slug, { ...existing, slug: result.slug, name: result.name })
      }
      return
    }

    const oldPath = target.tile.path
    const parent = parentFolderPath(oldPath)
    const newPath = joinFolderPath(parent, name)
    if (newPath === oldPath) return

    await options.moveFolder({ from: oldPath, to: newPath })
    await options.refresh()
    if (isSameOrDescendantFolder(options.currentPath.value, oldPath)) {
      options.goToFolder(renameFolderPrefix(options.currentPath.value, oldPath, newPath))
    }
  }

  const deleteTarget = async (target: MapLibraryContextTarget): Promise<void> => {
    if (target.type === 'map') {
      await options.deleteMap({ slug: target.item.slug })
      options.maps.delete(target.item.slug)
      return
    }

    const path = target.tile.path
    await options.deleteFolder({ folder: path })
    deleteMapFolderFromLibrary({ maps: options.maps, extraFolders: options.extraFolders }, path)
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
