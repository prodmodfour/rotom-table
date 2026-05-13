import { computed } from 'vue'
import {
  countFilteredSheetLibraryItems,
  filterVisibleSheetLibraryItems,
  type SheetLibraryItem,
} from '~/utils/sheetLibrary'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryContextSubmit } from '~/composables/library/useLibraryContextSubmit'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { useLibraryDropMove } from '~/composables/library/useLibraryDropMove'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
import { useLibraryGridView } from '~/composables/library/useLibraryGridView'
import {
  useSheetLibraryActions,
  type SheetLibraryContextTarget,
  type SheetLibraryDragPayload,
} from '~/composables/library/useSheetLibraryActions'
import { useSheetLibraryCreation } from '~/composables/library/useSheetLibraryCreation'
import { useSheetLibraryData } from '~/composables/library/useSheetLibraryData'
import { useApiClient } from '~/composables/useApiClient'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { isEscapeKey } from '~/utils/keyboardShortcuts'
import { sheetEditorPath, sheetLibraryPath } from '~/utils/sheetRoutes'

type SheetItem = SheetLibraryItem
type DragPayload = SheetLibraryDragPayload
type CtxTarget = SheetLibraryContextTarget

export const useSheetLibraryPage = () => {
  const { postJson } = useApiClient()

  const { isGm: rawIsGm, isPlayer: rawIsPlayer } = useAuth()
  const isGm = computed<boolean>(() => rawIsGm.value === true)
  const isPlayer = computed<boolean>(() => rawIsPlayer.value === true)
  const canDrag = computed<boolean>(() => Boolean(import.meta.dev && isGm.value))

  const {
    items,
    allFolders,
    extraFolders,
    sheetOverrides,
    folderRenames,
    nameOverrides,
    deletedSheets,
    deletedFolders,
  } = useSheetLibraryData({
    isGm,
    isPlayer,
    canLoadFolders: canDrag,
  })

  const { currentPath, goToFolder, breadcrumbs } = useLibraryFolderNavigation({
    routePath: sheetLibraryPath(),
  })

  const {
    searchTerm,
    visibleItems: visibleSheets,
    visibleFolders,
    hasAnything,
    totalCount,
    filteredCount,
  } = useLibraryGridView<SheetItem>({
    items,
    folderPaths: allFolders,
    currentPath,
    filterVisibleItems: filterVisibleSheetLibraryItems,
    countFilteredItems: countFilteredSheetLibraryItems,
  })

  const sheetActions = useSheetLibraryActions({
    currentPath,
    allFolders,
    items,
    extraFolders,
    sheetOverrides,
    folderRenames,
    nameOverrides,
    deletedSheets,
    deletedFolders,
    goToFolder,
    moveSheet: ({ kind, slug, folder }) => postJson(SHEET_API_PATHS.move, { kind, slug, folder }),
    moveFolder: ({ from, to }) => postJson(SHEET_API_PATHS.moveFolder, { from, to }),
    renameSheet: ({ kind, slug, name }) => postJson(SHEET_API_PATHS.rename, { kind, slug, name }),
    deleteSheet: ({ kind, slug }) => postJson(SHEET_API_PATHS.deleteSheet, { kind, slug }),
    deleteFolder: ({ folder }) => postJson(SHEET_API_PATHS.deleteFolder, { folder }),
  })

  const {
    drag,
    hoverTarget,
    startDrag,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    takeDropPayload,
  } = useLibraryDragDrop<DragPayload>({
    canDrag,
    canDropPayloadOn: sheetActions.canDropPayloadOn,
  })

  const isDraggingSheet = (item: SheetItem): boolean =>
    drag.value?.type === 'sheet'
    && drag.value.kind === item.kind
    && drag.value.slug === item.slug

  const isDraggingFolder = (path: string): boolean =>
    drag.value?.type === 'folder' && drag.value.path === path

  const onSheetDragStart = (event: DragEvent, item: SheetItem) => {
    startDrag(event, { type: 'sheet', kind: item.kind, slug: item.slug, from: item.folder }, {
      mimeType: 'application/x-rotom-sheet',
      // Required for Firefox to actually start the drag.
      value: `${item.kind}:${item.slug}`,
    })
  }

  const onFolderDragStart = (event: DragEvent, path: string) => {
    if (!path) {
      event.preventDefault()
      return
    }
    startDrag(event, { type: 'folder', path }, {
      mimeType: 'application/x-rotom-folder',
      value: path,
    })
  }

  const { moveError, onDrop } = useLibraryDropMove<DragPayload>({
    takeDropPayload,
    movePayload: sheetActions.movePayload,
    onError: (error) => console.error('[sheets] move failed', error),
  })

  const { creating, createError, createNewFolder } = useLibraryFolderCreation({
    canCreate: canDrag,
    currentPath,
    folderPaths: allFolders,
    createFolder: (folder) => postJson(SHEET_API_PATHS.createFolder, { folder }),
    onCreated: (folder) => extraFolders.add(folder),
  })

  const {
    sheetMenuOpen,
    creatingSheet,
    sheetCreateError,
    toggleSheetMenu,
    closeSheetMenu,
    createSheet,
  } = useSheetLibraryCreation({
    canCreate: canDrag,
    currentPath,
    createSheet: (kind, folder) => postJson<{ ok: true; kind: 'pokemon' | 'trainer'; slug: string }>(
      SHEET_API_PATHS.create,
      { kind, folder },
    ),
    // Hard-navigate so the editor route starts with a fresh server-loaded
    // sheet payload instead of relying on the stale static data glob cache.
    navigateToSheet: (kind, slug) => {
      window.location.href = sheetEditorPath(kind, slug)
    },
  })

  const {
    ctx,
    openContext,
    closeContext,
    ctxTargetLabel,
    ctxMoveDestinations,
    enterMove,
    enterRename,
    enterDelete,
  } = useLibraryContextMenu<CtxTarget>({
    canOpen: canDrag,
    targetLabel: sheetActions.targetLabel,
    renameInputForTarget: sheetActions.renameInputForTarget,
    moveDestinationsForTarget: sheetActions.moveDestinationsForTarget,
  })

  const { submitContext } = useLibraryContextSubmit<CtxTarget>({
    ctx,
    closeContext,
    onMove: sheetActions.moveTarget,
    onRename: sheetActions.renameTarget,
    onDelete: sheetActions.deleteTarget,
  })

  useWindowKeydown((event) => {
    if (!isEscapeKey(event)) return
    closeContext()
    closeSheetMenu()
  })

  return {
    canDrag,
    searchTerm,
    visibleSheets,
    visibleFolders,
    hasAnything,
    totalCount,
    filteredCount,
    currentPath,
    breadcrumbs,
    goToFolder,
    drag,
    hoverTarget,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    onDrop,
    moveError,
    isDraggingSheet,
    isDraggingFolder,
    onSheetDragStart,
    onFolderDragStart,
    creating,
    createError,
    createNewFolder,
    sheetMenuOpen,
    creatingSheet,
    sheetCreateError,
    toggleSheetMenu,
    closeSheetMenu,
    createSheet,
    ctx,
    openContext,
    closeContext,
    ctxTargetLabel,
    ctxMoveDestinations,
    enterMove,
    enterRename,
    enterDelete,
    submitContext,
  }
}
