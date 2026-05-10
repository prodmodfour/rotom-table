<script setup lang="ts">
import FolderTileButton from '~/components/library/FolderTileButton.vue'
import LibraryGridSection from '~/components/library/LibraryGridSection.vue'
import MapLibraryCard from '~/components/library/MapLibraryCard.vue'
import type { FolderTile } from '~/utils/folderBrowser'
import type { MapSummary } from '~/types/map'

defineProps<{
  folders: FolderTile[]
  maps: MapSummary[]
  hasAnything: boolean
  hoverTarget: string | null
  isDragging: boolean
  isGm: boolean
  loading: boolean
  searchTerm: string
  canDropOn: (path: string) => boolean
}>()

const emit = defineEmits<{
  openFolder: [path: string]
  folderContext: [event: MouseEvent, tile: FolderTile]
  folderDragStart: [event: DragEvent, path: string]
  dragEnd: []
  dragenter: [event: DragEvent, path: string]
  dragover: [event: DragEvent, path: string]
  dragleave: [path: string]
  drop: [event: DragEvent, path: string]
  mapContext: [event: MouseEvent, item: MapSummary]
  mapDragStart: [event: DragEvent, item: MapSummary]
}>()
</script>

<template>
  <LibraryGridSection
    :has-anything="hasAnything"
    :loading="loading"
    :search-term="searchTerm"
  >
    <FolderTileButton
      v-for="folder in folders"
      :key="`folder-${folder.path}`"
      :tile="folder"
      :hover-target="hoverTarget"
      :is-dragging="isDragging"
      :draggable="isGm"
      item-label-singular="map"
      :can-drop-on="canDropOn"
      @open="emit('openFolder', $event)"
      @contextmenu="(event, tile) => emit('folderContext', event, tile)"
      @dragstart="(event, path) => emit('folderDragStart', event, path)"
      @dragend="emit('dragEnd')"
      @dragenter="(event, path) => emit('dragenter', event, path)"
      @dragover="(event, path) => emit('dragover', event, path)"
      @dragleave="emit('dragleave', $event)"
      @drop="(event, path) => emit('drop', event, path)"
    />

    <MapLibraryCard
      v-for="item in maps"
      :key="`map-${item.slug}`"
      :item="item"
      :can-drag="isGm"
      :show-player-visible-badge="isGm"
      @contextmenu="(event, map) => emit('mapContext', event, map)"
      @dragstart="(event, map) => emit('mapDragStart', event, map)"
      @dragend="emit('dragEnd')"
    />

    <template #empty>
      <template v-if="isGm">
        No maps yet. Click <strong>+ New map</strong> to start a tabletop.
      </template>
      <template v-else>
        No player-visible maps yet.
      </template>
    </template>
  </LibraryGridSection>
</template>
