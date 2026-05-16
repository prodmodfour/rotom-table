<script setup lang="ts">
import FolderTileButton from '~/components/library/FolderTileButton.vue'
import LibraryGridSection from '~/components/library/LibraryGridSection.vue'
import type { FolderTile } from '~/utils/folderBrowser'
import { encounterTableLibraryKey } from '~/utils/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

defineProps<{
  folders: FolderTile[]
  tables: EncounterTableEntry[]
  hasAnything: boolean
  hoverTarget: string | null
  isDragging: boolean
  canManage: boolean
  loading: boolean
  searchTerm: string
  selectedId: string | null
  canDropOn: (path: string) => boolean
  isDraggingFolder: (path: string) => boolean
  isDraggingTable: (entry: EncounterTableEntry) => boolean
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
  selectTable: [entry: EncounterTableEntry]
  tableContext: [event: MouseEvent, item: EncounterTableEntry]
  tableDragStart: [event: DragEvent, item: EncounterTableEntry]
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
      :draggable="canManage"
      :is-dragging-self="isDraggingFolder(folder.path)"
      item-label-singular="table"
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

    <EncounterTableLibraryCard
      v-for="item in tables"
      :key="encounterTableLibraryKey(item)"
      :item="item"
      :selected="selectedId === encounterTableLibraryKey(item)"
      :can-drag="canManage"
      :is-dragging-self="isDraggingTable(item)"
      @select="emit('selectTable', $event)"
      @contextmenu="(event, table) => emit('tableContext', event, table)"
      @dragstart="(event, table) => emit('tableDragStart', event, table)"
      @dragend="emit('dragEnd')"
    />

    <template #empty>
      <template v-if="canManage">
        This folder is empty. Click <strong>+ New table</strong> to add an
        encounter table, or <strong>+ New folder</strong> to add a subfolder.
      </template>
      <template v-else>
        No encounter tables in this folder.
      </template>
    </template>
  </LibraryGridSection>
</template>
