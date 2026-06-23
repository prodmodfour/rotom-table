<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import MapLibraryGrid from '~/components/library/MapLibraryGrid.vue'
import MapLibraryIntroPanel from '~/components/library/MapLibraryIntroPanel.vue'
import { useMapLibraryPage } from '~/composables/library/useMapLibraryPage'

useHead({ title: 'Maps · Rotom Table' })

const {
  isGm,
  searchTerm,
  visibleMaps,
  visibleFolders,
  hasAnything,
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
  loading,
  loadError,
  moveError,
  onMapDragStart,
  onFolderDragStart,
  creating,
  createError,
  createNewFolder,
  createNewMap,
  ctx,
  openContext,
  closeContext,
  ctxTargetLabel,
  ctxMoveDestinations,
  enterMove,
  enterRename,
  enterDelete,
  submitContext,
} = useMapLibraryPage()
</script>

<template>
  <LibraryPageLayout :dragging="drag !== null">
    <template #header>
      <AppNavigation />

      <div class="map-library-controls">
        <MapLibraryIntroPanel
          v-model:search-term="searchTerm"
          :is-gm="isGm"
          :creating="creating"
          :load-error="loadError"
          :create-error="createError"
          :move-error="moveError"
          @create-map="createNewMap"
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
      </div>
    </template>

    <MapLibraryGrid
      :folders="visibleFolders"
      :maps="visibleMaps"
      :has-anything="hasAnything"
      :hover-target="hoverTarget"
      :is-dragging="drag !== null"
      :is-gm="isGm"
      :loading="loading"
      :search-term="searchTerm"
      :can-drop-on="canDropOn"
      @open-folder="goToFolder"
      @folder-context="(event, tile) => openContext(event, { type: 'folder', tile })"
      @folder-drag-start="onFolderDragStart"
      @drag-end="onDragEnd"
      @dragenter="onDropEnter"
      @dragover="onDropOver"
      @dragleave="onDropLeave"
      @drop="onDrop"
      @map-context="(event, item) => openContext(event, { type: 'map', item })"
      @map-drag-start="onMapDragStart"
    />

    <LibraryContextMenu
      v-if="ctx"
      v-model:input="ctx.input"
      :x="ctx.x"
      :y="ctx.y"
      :target-kind="ctx.target.type === 'map' ? 'Map' : 'Folder'"
      :target-label="ctxTargetLabel"
      :is-folder-target="ctx.target.type === 'folder'"
      :mode="ctx.mode"
      :busy="ctx.busy"
      :error="ctx.error"
      :move-destinations="ctxMoveDestinations"
      delete-folder-suffix="and every map inside? This cannot be undone."
      delete-item-suffix="? The SQLite map document will be removed."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
  </LibraryPageLayout>
</template>

<style scoped>
.map-library-controls {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.map-library-controls :deep(.library-intro-panel),
.map-library-controls :deep(.breadcrumbs.panel-card) {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.map-library-controls :deep(.library-intro-panel) {
  padding: 0.95rem 0.95rem 0.8rem;
}

.map-library-controls :deep(.breadcrumbs.panel-card) {
  padding: 0 0.65rem 0.5rem;
}
</style>
