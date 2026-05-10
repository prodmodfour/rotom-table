<script setup lang="ts">
import { PhSquaresFour } from '@phosphor-icons/vue'
import LibraryCardBadge from '~/components/library/LibraryCardBadge.vue'
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
      <LibraryCardBadge
        v-if="showPlayerVisibleBadge && item.playerVisible"
        variant="success"
        spacing="stacked"
      >
        Player visible
      </LibraryCardBadge>
    </LibraryCardText>
  </LibraryCardShell>
</template>
