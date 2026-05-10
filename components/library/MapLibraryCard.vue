<script setup lang="ts">
import { PhSquaresFour } from '@phosphor-icons/vue'
import LibraryCardShell from '~/components/library/LibraryCardShell.vue'
import { mapEditorPath } from '~/utils/mapRoutes'
import type { MapSummary } from '~/types/map'

defineProps<{
  item: MapSummary
  canDrag: boolean
  showPlayerVisibleBadge: boolean
}>()

const emit = defineEmits<{
  contextmenu: [event: MouseEvent, item: MapSummary]
  dragstart: [event: DragEvent, item: MapSummary]
  dragend: []
}>()
</script>

<template>
  <LibraryCardShell
    :to="mapEditorPath(item.slug)"
    :can-drag="canDrag"
    align="center"
    @contextmenu="emit('contextmenu', $event, item)"
    @dragstart="emit('dragstart', $event, item)"
    @dragend="emit('dragend')"
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
      <span v-if="showPlayerVisibleBadge && item.playerVisible" class="map-card__badge">
        Player visible
      </span>
    </div>
  </LibraryCardShell>
</template>

<style scoped>
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
</style>
