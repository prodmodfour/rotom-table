<script setup lang="ts">
import FolderTileButton from '~/components/library/FolderTileButton.vue'
import SheetLibraryCard from '~/components/library/SheetLibraryCard.vue'
import type { FolderTile } from '~/utils/folderBrowser'
import { sheetLibraryKey, type SheetLibraryItem } from '~/utils/sheetLibrary'

defineProps<{
  folders: FolderTile[]
  sheets: SheetLibraryItem[]
  hasAnything: boolean
  hoverTarget: string | null
  isDragging: boolean
  canDrag: boolean
  searchTerm: string
  canDropOn: (path: string) => boolean
  isDraggingFolder: (path: string) => boolean
  isDraggingSheet: (item: SheetLibraryItem) => boolean
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
  sheetContext: [event: MouseEvent, item: SheetLibraryItem]
  sheetDragStart: [event: DragEvent, item: SheetLibraryItem]
}>()
</script>

<template>
  <section class="sheet-section">
    <div v-if="hasAnything" class="sheets-grid">
      <FolderTileButton
        v-for="folder in folders"
        :key="`folder-${folder.path}`"
        :tile="folder"
        :hover-target="hoverTarget"
        :is-dragging="isDragging"
        :draggable="canDrag"
        :is-dragging-self="isDraggingFolder(folder.path)"
        item-label-singular="item"
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

      <SheetLibraryCard
        v-for="item in sheets"
        :key="sheetLibraryKey(item.kind, item.slug)"
        :item="item"
        :can-drag="canDrag"
        :is-dragging-self="isDraggingSheet(item)"
        @contextmenu="(event, sheet) => emit('sheetContext', event, sheet)"
        @dragstart="(event, sheet) => emit('sheetDragStart', event, sheet)"
        @dragend="emit('dragEnd')"
      />
    </div>

    <p v-else-if="searchTerm" class="empty-state">
      Nothing matches that search.
    </p>
    <p v-else class="empty-state">
      <template v-if="canDrag">
        This folder is empty. Drag a sheet here from another folder or use
        <strong>+ New folder</strong> to add a subfolder.
      </template>
      <template v-else>
        No player-accessible sheets in this folder.
      </template>
    </p>
  </section>
</template>

<style scoped>
.sheet-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sheets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
  align-items: stretch;
}

.empty-state {
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}
</style>
