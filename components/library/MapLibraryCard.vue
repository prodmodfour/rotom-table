<script setup lang="ts">
import { PhSquaresFour } from '@phosphor-icons/vue'
import LibraryCardMedia from '~/components/library/LibraryCardMedia.vue'
import LibraryCardShell from '~/components/library/LibraryCardShell.vue'
import LibraryCardText from '~/components/library/LibraryCardText.vue'
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
    <LibraryCardMedia size="map" tone="accent">
      <PhSquaresFour :size="42" weight="duotone" aria-hidden="true" />
    </LibraryCardMedia>
    <LibraryCardText
      :title="item.name"
      :subtitle="`${item.dimensions.x} × ${item.dimensions.y} × ${item.dimensions.z} · ${item.placementCount} token${item.placementCount === 1 ? '' : 's'}`"
      title-size="compact"
      subtitle-tone="muted"
      subtitle-size="compact"
    >
      <span v-if="showPlayerVisibleBadge && item.playerVisible" class="map-card__badge">
        Player visible
      </span>
    </LibraryCardText>
  </LibraryCardShell>
</template>

<style scoped>
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
