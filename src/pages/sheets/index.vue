<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import SheetLibraryGrid from '~/components/library/SheetLibraryGrid.vue'
import SheetLibraryIntroPanel from '~/components/library/SheetLibraryIntroPanel.vue'
import { useSheetLibraryPage } from '~/composables/library/useSheetLibraryPage'

useHead({
  title: 'Sheets · Rotom Table',
})

const {
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
} = useSheetLibraryPage()
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
