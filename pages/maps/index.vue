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
  mapCount,
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

      <MapLibraryIntroPanel
        v-model:search-term="searchTerm"
        :map-count="mapCount"
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
      delete-item-suffix="? The JSON file will be removed from disk."
      @close="closeContext"
      @enter-move="enterMove"
      @enter-rename="enterRename"
      @enter-delete="enterDelete"
      @submit="submitContext"
    />
  </LibraryPageLayout>
</template>
