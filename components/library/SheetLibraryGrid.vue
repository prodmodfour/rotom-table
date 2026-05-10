<script setup lang="ts">
import type { FolderTile } from '~/utils/folderBrowser'
import { sheetLibraryKey, type SheetLibraryItem } from '~/utils/sheetLibrary'
import { sheetEditorPath } from '~/utils/sheetRoutes'

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

      <template v-for="item in sheets" :key="sheetLibraryKey(item.kind, item.slug)">
        <NuxtLink
          v-if="item.kind === 'pokemon'"
          :to="sheetEditorPath(item.kind, item.slug)"
          class="sheet-card"
          :class="{ 'is-dragging-self': isDraggingSheet(item) }"
          :draggable="canDrag"
          @contextmenu="emit('sheetContext', $event, item)"
          @dragstart="emit('sheetDragStart', $event, item)"
          @dragend="emit('dragEnd')"
        >
          <div class="sheet-card__sprite">
            <img v-if="item.spriteUrl" :src="item.spriteUrl" :alt="item.sheet.species" />
            <span v-else class="sprite-missing">?</span>
          </div>
          <div class="sheet-card__body">
            <div class="sheet-card__heading">
              <h3>{{ item.sheet.nickname }}</h3>
              <span v-if="item.sheet.shiny" class="badge shiny" title="Shiny">★</span>
            </div>
            <p class="sheet-card__species">
              {{ item.sheet.species }} · Lv {{ item.sheet.level }}
            </p>
            <ul class="sheet-card__meta">
              <li v-if="item.sheet.nature">{{ item.sheet.nature }}</li>
              <li v-if="item.sheet.gender">{{ item.sheet.gender }}</li>
              <li v-if="item.types.length" class="sheet-card__types">
                <TypeBadge
                  v-for="type in item.types"
                  :key="`${item.slug}-${type}`"
                  :type="type"
                  size="xs"
                />
              </li>
            </ul>
          </div>
        </NuxtLink>

        <NuxtLink
          v-else
          :to="sheetEditorPath(item.kind, item.slug)"
          class="sheet-card sheet-card--trainer"
          :class="{ 'is-dragging-self': isDraggingSheet(item) }"
          :draggable="canDrag"
          @contextmenu="emit('sheetContext', $event, item)"
          @dragstart="emit('sheetDragStart', $event, item)"
          @dragend="emit('dragEnd')"
        >
          <div class="sheet-card__sprite trainer-icon">
            <span aria-hidden="true">🎯</span>
          </div>
          <div class="sheet-card__body">
            <div class="sheet-card__heading">
              <h3>{{ item.sheet.name }}</h3>
            </div>
            <p class="sheet-card__species">
              Trainer · Lv {{ item.sheet.level }}
              <span v-if="item.sheet.classes?.length">· {{ item.sheet.classes.map((c) => c.name).join(', ') }}</span>
            </p>
            <ul class="sheet-card__meta">
              <li v-if="item.sheet.skillBackground?.name">{{ item.sheet.skillBackground.name }}</li>
              <li v-if="item.sheet.sex">{{ item.sheet.sex }}</li>
              <li v-if="item.sheet.playedBy">PB: {{ item.sheet.playedBy }}</li>
            </ul>
          </div>
        </NuxtLink>
      </template>
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

.sheet-card {
  display: flex;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-decoration: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.sheet-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.sheet-card[draggable='true'] {
  cursor: grab;
}

.sheet-card[draggable='true']:active {
  cursor: grabbing;
}

.sheet-card.is-dragging-self {
  opacity: 0.4;
}

.sheet-card--trainer {
  /* Trainer cards share the parchment look but get a slightly stronger left
     edge so they read as a separate kind of entry. */
  border-left: 2px solid var(--rule-strong);
}

.sheet-card--trainer:hover {
  border-color: var(--rule-active);
  border-left-color: var(--accent);
}

.trainer-icon {
  font-size: 1.8rem;
  display: grid;
  place-items: center;
}

.sheet-card__sprite {
  flex: 0 0 auto;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.3rem;
}

.sheet-card__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.sprite-missing {
  color: var(--ink-faint);
  font-size: 1.4rem;
  font-weight: 700;
}

.sheet-card__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sheet-card__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sheet-card__heading h2,
.sheet-card__heading h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
}

.sheet-card__species {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.sheet-card__meta {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.sheet-card__meta li {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--paper-inset);
  border: 1px solid var(--rule);
}

.sheet-card__meta .sheet-card__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  padding: 0;
  border: 0;
  background: transparent;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.badge.shiny {
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  padding: 0.18rem 0.5rem;
  font-size: 0.95rem;
  line-height: 1;
}

.empty-state {
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}
</style>
