<script setup lang="ts">
import { PhSquaresFour } from '@phosphor-icons/vue'
import FolderTileButton from '~/components/library/FolderTileButton.vue'
import { mapEditorPath } from '~/utils/mapRoutes'
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
  <section class="map-section">
    <div v-if="hasAnything" class="maps-grid">
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

      <NuxtLink
        v-for="item in maps"
        :key="`map-${item.slug}`"
        :to="mapEditorPath(item.slug)"
        class="map-card"
        :draggable="isGm"
        @contextmenu="emit('mapContext', $event, item)"
        @dragstart="emit('mapDragStart', $event, item)"
        @dragend="emit('dragEnd')"
      >
        <div class="map-card__icon">
          <PhSquaresFour :size="42" weight="duotone" aria-hidden="true" />
        </div>
        <div class="map-card__body">
          <h3>{{ item.name }}</h3>
          <p class="map-card__meta">
            {{ item.dimensions.x }} × {{ item.dimensions.y }} × {{ item.dimensions.z }}
            · {{ item.placementCount }} token{{ item.placementCount === 1 ? '' : 's' }}
          </p>
          <span v-if="isGm && item.playerVisible" class="map-card__badge">Player visible</span>
        </div>
      </NuxtLink>
    </div>

    <p v-else-if="loading" class="empty-state">Loading…</p>
    <p v-else-if="searchTerm" class="empty-state">Nothing matches that search.</p>
    <p v-else class="empty-state">
      <template v-if="isGm">
        No maps yet. Click <strong>+ New map</strong> to start a tabletop.
      </template>
      <template v-else>
        No player-visible maps yet.
      </template>
    </p>
  </section>
</template>

<style scoped>
.map-section {
  display: flex;
  flex-direction: column;
}

.maps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
}

.map-card {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.map-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.map-card__icon {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--accent);
}

.map-card__body {
  min-width: 0;
}

.map-card__body h3 {
  margin: 0 0 0.2rem;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-card__meta {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}

.map-card__badge {
  display: inline-flex;
  width: fit-content;
  margin-top: 0.45rem;
  border-radius: 999px;
  padding: 0.18rem 0.55rem;
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.empty-state {
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}
</style>
