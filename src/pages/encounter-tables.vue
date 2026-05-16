<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import EncounterTableDetailPanel from '~/components/encounters/EncounterTableDetailPanel.vue'
import EncounterTableLibraryGrid from '~/components/encounters/EncounterTableLibraryGrid.vue'
import EncounterTableLibraryIntroPanel from '~/components/encounters/EncounterTableLibraryIntroPanel.vue'
import { useEncounterTableLibraryPage } from '~/composables/encounters/useEncounterTableLibraryPage'

useHead({
  title: 'Encounter Tables · Rotom Table',
})

const {
  canManage,
  searchTerm,
  visibleTables,
  visibleFolders,
  hasAnything,
  totalCount,
  filteredCount,
  currentPath,
  breadcrumbs,
  goToFolder,
  selectedId,
  selectedEntry,
  selectedRows,
  selectEntry,
  drag,
  hoverTarget,
  canDropOn,
  onDragEnd,
  onDropEnter,
  onDropOver,
  onDropLeave,
  onDrop,
  loading,
  loadError,
  moveError,
  isDraggingTable,
  isDraggingFolder,
  onTableDragStart,
  onFolderDragStart,
  creating,
  createError,
  createNewFolder,
  createNewTable,
  ctx,
  openContext,
  closeContext,
  ctxTargetLabel,
  ctxMoveDestinations,
  enterMove,
  enterRename,
  enterDelete,
  submitContext,
} = useEncounterTableLibraryPage()
</script>

<template>
  <LibraryPageLayout :dragging="drag !== null">
    <template #header>
      <AppNavigation />

      <EncounterTableLibraryIntroPanel
        v-model:search-term="searchTerm"
        :filtered-count="filteredCount"
        :total-count="totalCount"
        :can-manage="canManage"
        :creating="creating"
        :load-error="loadError"
        :create-error="createError"
        :move-error="moveError"
        @create-table="createNewTable"
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

    <div class="encounter-library-body">
      <EncounterTableLibraryGrid
        :folders="visibleFolders"
        :tables="visibleTables"
        :has-anything="hasAnything"
        :hover-target="hoverTarget"
        :is-dragging="drag !== null"
        :can-manage="canManage"
        :loading="loading"
        :search-term="searchTerm"
        :selected-id="selectedId"
        :can-drop-on="canDropOn"
        :is-dragging-folder="isDraggingFolder"
        :is-dragging-table="isDraggingTable"
        @open-folder="goToFolder"
        @folder-context="(event, tile) => openContext(event, { type: 'folder', tile })"
        @folder-drag-start="onFolderDragStart"
        @drag-end="onDragEnd"
        @dragenter="onDropEnter"
        @dragover="onDropOver"
        @dragleave="onDropLeave"
        @drop="onDrop"
        @select-table="selectEntry"
        @table-context="(event, item) => openContext(event, { type: 'table', item })"
        @table-drag-start="onTableDragStart"
      />

      <EncounterTableDetailPanel
        :selected-entry="selectedEntry"
        :selected-rows="selectedRows"
      />
    </div>

    <LibraryContextMenu
      v-if="ctx"
      v-model:input="ctx.input"
      :x="ctx.x"
      :y="ctx.y"
      :target-kind="ctx.target.type === 'table' ? 'Encounter Table' : 'Folder'"
      :target-label="ctxTargetLabel"
      :is-folder-target="ctx.target.type === 'folder'"
      :mode="ctx.mode"
      :busy="ctx.busy"
      :error="ctx.error"
      :move-destinations="ctxMoveDestinations"
      delete-folder-suffix="and every encounter table inside? This cannot be undone."
      delete-item-suffix="? The JSON file will be removed from disk."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
  </LibraryPageLayout>
</template>

<style scoped>
.encounter-library-body {
  display: grid;
  grid-template-columns: minmax(300px, 520px) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

@media (max-width: 1120px) {
  .encounter-library-body {
    grid-template-columns: 1fr;
  }
}
</style>
