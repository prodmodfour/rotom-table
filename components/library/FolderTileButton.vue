<script setup lang="ts">
import { PhFolder, PhFolderOpen } from '@phosphor-icons/vue'
import type { FolderTile } from '~/utils/folderBrowser'

withDefaults(defineProps<{
  tile: FolderTile
  hoverTarget: string | null
  isDragging: boolean
  draggable: boolean
  isDraggingSelf?: boolean
  itemLabelSingular: string
  canDropOn: (path: string) => boolean
}>(), {
  isDraggingSelf: false,
})

const emit = defineEmits<{
  open: [path: string]
  contextmenu: [event: MouseEvent, tile: FolderTile]
  dragstart: [event: DragEvent, path: string]
  dragend: []
  dragenter: [event: DragEvent, path: string]
  dragover: [event: DragEvent, path: string]
  dragleave: [path: string]
  drop: [event: DragEvent, path: string]
}>()
</script>

<template>
  <button
    type="button"
    class="folder-tile"
    :class="{
      'drop-target': hoverTarget === tile.path,
      'drop-disabled': isDragging && !canDropOn(tile.path),
      'is-dragging-self': isDraggingSelf,
    }"
    :draggable="draggable"
    @click="emit('open', tile.path)"
    @contextmenu="emit('contextmenu', $event, tile)"
    @dragstart="emit('dragstart', $event, tile.path)"
    @dragend="emit('dragend')"
    @dragenter="emit('dragenter', $event, tile.path)"
    @dragover="emit('dragover', $event, tile.path)"
    @dragleave="emit('dragleave', tile.path)"
    @drop="emit('drop', $event, tile.path)"
  >
    <span class="folder-tile__icon">
      <PhFolderOpen
        v-if="hoverTarget === tile.path && canDropOn(tile.path)"
        :size="48"
        weight="duotone"
        aria-hidden="true"
      />
      <PhFolder v-else :size="48" weight="duotone" aria-hidden="true" />
    </span>
    <div class="folder-tile__body">
      <span class="folder-tile__label">{{ tile.label }}</span>
      <span class="folder-tile__meta">
        {{ tile.count }} {{ itemLabelSingular }}{{ tile.count === 1 ? '' : 's' }}
      </span>
    </div>
  </button>
</template>

<style scoped>
.folder-tile {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.1s ease,
    opacity 0.15s ease;
}

.folder-tile:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.folder-tile:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.folder-tile[draggable='true']:active {
  cursor: grabbing;
  transform: scale(0.99);
}

.folder-tile.drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.folder-tile.drop-disabled {
  opacity: 0.45;
}

.folder-tile.is-dragging-self {
  opacity: 0.4;
}

.folder-tile__icon {
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--accent);
}

.folder-tile.drop-target .folder-tile__icon {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--paper-soft);
}

.folder-tile__body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.folder-tile__label {
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-tile__meta {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}
</style>
