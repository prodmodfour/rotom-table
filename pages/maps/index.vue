<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppNavigation from '~/components/AppNavigation.vue'
import FolderBreadcrumbNav from '~/components/library/FolderBreadcrumbNav.vue'
import LibraryContextMenu from '~/components/library/LibraryContextMenu.vue'
import LibraryPageLayout from '~/components/library/LibraryPageLayout.vue'
import MapLibraryGrid from '~/components/library/MapLibraryGrid.vue'
import MapLibraryIntroPanel from '~/components/library/MapLibraryIntroPanel.vue'
import { formatFolderLabel } from '~/utils/sheetFolders'
import { getClientId } from '~/utils/clientId'
import {
  buildMapFolderSet,
  filterVisibleMaps,
  tabletopMapToSummary,
} from '~/utils/mapLibrary'
import {
  useMapLibraryActions,
  type MapLibraryContextTarget,
  type MapLibraryDragPayload,
} from '~/composables/library/useMapLibraryActions'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryContextSubmit } from '~/composables/library/useLibraryContextSubmit'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { useLibraryDropMove } from '~/composables/library/useLibraryDropMove'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
import { useLibraryGridView } from '~/composables/library/useLibraryGridView'
import { useMapLibraryCreation } from '~/composables/library/useMapLibraryCreation'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { isEscapeKey } from '~/utils/keyboardShortcuts'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import type { MapSummary, TabletopMap } from '~/types/map'

useHead({ title: 'Maps · Rotom Table' })

const router = useRouter()
const clientId = getClientId()
const postJson = $fetch as unknown as <T = unknown>(
  request: string,
  options: { method: 'POST'; body: unknown },
) => Promise<T>
const { isGm, isPlayer } = useAuth()

const {
  maps,
  extraFolders,
  loading,
  loadError,
  refresh,
} = useMapLibraryData({ clientId })

const items = computed(() => {
  const all = Array.from(maps.values())
  return isPlayer.value ? all.filter((map) => map.playerVisible === true) : all
})

const allFolders = computed(() => buildMapFolderSet(items.value, extraFolders))

const { currentPath, goToFolder, breadcrumbs } = useLibraryFolderNavigation({
  routePath: mapLibraryPath(),
  formatSegment: formatFolderLabel,
})

const { creating, createError, createNewFolder } = useLibraryFolderCreation({
  canCreate: isGm,
  currentPath,
  folderPaths: allFolders,
  createFolder: (folder) => postJson('/api/maps/create-folder', {
    method: 'POST',
    body: { folder, clientId },
  }),
  onCreated: (folder) => extraFolders.add(folder),
})

const {
  searchTerm,
  visibleItems: visibleMaps,
  visibleFolders,
  hasAnything,
  totalCount: mapCount,
} = useLibraryGridView<MapSummary>({
  items,
  folderPaths: allFolders,
  currentPath,
  filterVisibleItems: filterVisibleMaps,
  formatFolderLabel,
})

type DragPayload = MapLibraryDragPayload

type CtxTarget = MapLibraryContextTarget

const mapActions = useMapLibraryActions({
  currentPath,
  allFolders,
  maps,
  extraFolders,
  goToFolder,
  refresh,
  formatFolderLabel,
  moveMap: ({ slug, folder }) => postJson('/api/maps/move', {
    method: 'POST',
    body: { slug, folder, clientId },
  }),
  moveFolder: ({ from, to }) => postJson('/api/maps/move-folder', {
    method: 'POST',
    body: { from, to, clientId },
  }),
  renameMap: ({ slug, name }) => postJson<{ slug: string; name: string }>('/api/maps/rename', {
    method: 'POST',
    body: { slug, name, clientId },
  }),
  deleteMap: ({ slug }) => postJson('/api/maps/delete', {
    method: 'POST',
    body: { slug, clientId },
  }),
  deleteFolder: ({ folder }) => postJson('/api/maps/delete-folder', {
    method: 'POST',
    body: { folder, clientId },
  }),
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
  canDrag: isGm,
  canDropPayloadOn: mapActions.canDropPayloadOn,
})

const onMapDragStart = (e: DragEvent, item: MapSummary) => {
  startDrag(e, { type: 'map', slug: item.slug, from: item.folder }, {
    mimeType: 'application/x-rotom-map',
    value: item.slug,
  })
}

const onFolderDragStart = (e: DragEvent, path: string) => {
  if (!path) {
    e.preventDefault()
    return
  }
  startDrag(e, { type: 'folder', path }, {
    mimeType: 'application/x-rotom-map-folder',
    value: path,
  })
}

const { moving, moveError, onDrop } = useLibraryDropMove<DragPayload>({
  takeDropPayload,
  movePayload: mapActions.movePayload,
})

const { createNewMap } = useMapLibraryCreation({
  canCreate: isGm,
  currentPath,
  state: { creating, createError },
  createMap: (folder) => postJson<{ map: TabletopMap }>('/api/maps/create', {
    method: 'POST',
    body: { folder, clientId },
  }),
  onCreated: (map) => maps.set(map.slug, tabletopMapToSummary(map)),
  navigateToMap: (slug) => {
    void router.push(mapEditorPath(slug))
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
  canOpen: isGm,
  targetLabel: mapActions.targetLabel,
  renameInputForTarget: mapActions.renameInputForTarget,
  moveDestinationsForTarget: mapActions.moveDestinationsForTarget,
})

const { submitContext } = useLibraryContextSubmit<CtxTarget>({
  ctx,
  closeContext,
  onMove: mapActions.moveTarget,
  onRename: mapActions.renameTarget,
  onDelete: mapActions.deleteTarget,
})

useWindowKeydown((event) => {
  if (isEscapeKey(event)) closeContext()
})
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
