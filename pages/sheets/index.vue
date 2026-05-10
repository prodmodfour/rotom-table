<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import SheetLibraryGrid from '~/components/library/SheetLibraryGrid.vue'
import SheetLibraryIntroPanel from '~/components/library/SheetLibraryIntroPanel.vue'
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

useHead({
  title: 'Sheets · Rotom Table',
})

const { postJson } = useApiClient()

const { isGm: rawIsGm, isPlayer: rawIsPlayer } = useAuth()
const isGm = computed<boolean>(() => rawIsGm.value === true)
const isPlayer = computed<boolean>(() => rawIsPlayer.value === true)

const canDrag = computed<boolean>(() => Boolean(import.meta.dev && isGm.value))

type SheetItem = SheetLibraryItem

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

// ---------------------------------------------------------------------------
// Folder navigation. The current folder lives in the URL as `?folder=foo/bar`
// so the browser back/forward buttons work and links can deep-link to a
// subfolder.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drag and drop. Drop targets are folder tiles and breadcrumb items; the
// "Home" breadcrumb is the root drop target. Dev-only — moves are persisted
// via `/api/sheets/move(-folder)` which write to disk.
// ---------------------------------------------------------------------------

type DragPayload = SheetLibraryDragPayload

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

const onSheetDragStart = (e: DragEvent, item: SheetItem) => {
  startDrag(e, { type: 'sheet', kind: item.kind, slug: item.slug, from: item.folder }, {
    mimeType: 'application/x-rotom-sheet',
    // Required for Firefox to actually start the drag.
    value: `${item.kind}:${item.slug}`,
  })
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!path) {
    e.preventDefault()
    return
  }
  startDrag(e, { type: 'folder', path }, {
    mimeType: 'application/x-rotom-folder',
    value: path,
  })
}

const { moving, moveError, onDrop } = useLibraryDropMove<DragPayload>({
  takeDropPayload,
  movePayload: sheetActions.movePayload,
  onError: (error) => console.error('[sheets] move failed', error),
})

// ---------------------------------------------------------------------------
// New folder / sheet creation
// ---------------------------------------------------------------------------

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
  // Hard-navigate so Vite re-evaluates the sheet data globs before the editor
  // route loads; a client-side router push can race HMR and show "not found".
  navigateToSheet: (kind, slug) => {
    window.location.href = sheetEditorPath(kind, slug)
  },
})

// ---------------------------------------------------------------------------
// Right-click context menu (Move / Rename / Delete)
// ---------------------------------------------------------------------------

type CtxTarget = SheetLibraryContextTarget

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
</script>

<template>
  <LibraryPageLayout :dragging="drag !== null">
    <template #header>
      <AppNavigation />

      <SheetLibraryIntroPanel
        v-model:search-term="searchTerm"
        :filtered-count="filteredCount"
        :total-count="totalCount"
        :can-drag="canDrag"
        :creating="creating"
        :creating-sheet="creatingSheet"
        :sheet-menu-open="sheetMenuOpen"
        :create-error="createError"
        :sheet-create-error="sheetCreateError"
        :move-error="moveError"
        @toggle-sheet-menu="toggleSheetMenu"
        @close-sheet-menu="closeSheetMenu"
        @create-sheet="createSheet"
        @create-folder="createNewFolder"
      />

      <FolderBreadcrumbNav
        :breadcrumbs="breadcrumbs"
        :current-path="currentPath"
        :hover-target="hoverTarget"
        :is-dragging="drag !== null"
        :can-drop-on="canDropOn"
        @navigate="goToFolder"
        @dragenter="onDropEnter"
        @dragover="onDropOver"
        @dragleave="onDropLeave"
        @drop="onDrop"
      />
    </template>

    <SheetLibraryGrid
      :folders="visibleFolders"
      :sheets="visibleSheets"
      :has-anything="hasAnything"
      :hover-target="hoverTarget"
      :is-dragging="drag !== null"
      :can-drag="canDrag"
      :search-term="searchTerm"
      :can-drop-on="canDropOn"
      :is-dragging-folder="isDraggingFolder"
      :is-dragging-sheet="isDraggingSheet"
      @open-folder="goToFolder"
      @folder-context="(event, tile) => openContext(event, { type: 'folder', tile })"
      @folder-drag-start="onFolderDragStart"
      @drag-end="onDragEnd"
      @dragenter="onDropEnter"
      @dragover="onDropOver"
      @dragleave="onDropLeave"
      @drop="onDrop"
      @sheet-context="(event, item) => openContext(event, { type: 'sheet', item })"
      @sheet-drag-start="onSheetDragStart"
    />

    <LibraryContextMenu
      v-if="ctx"
      v-model:input="ctx.input"
      :x="ctx.x"
      :y="ctx.y"
      :target-kind="ctx.target.type === 'sheet' ? 'Sheet' : 'Folder'"
      :target-label="ctxTargetLabel"
      :is-folder-target="ctx.target.type === 'folder'"
      :mode="ctx.mode"
      :busy="ctx.busy"
      :error="ctx.error"
      :move-destinations="ctxMoveDestinations"
      delete-folder-suffix="and everything inside? This cannot be undone."
      delete-item-suffix="? The JSON file will be removed from disk."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
  </LibraryPageLayout>
</template>
