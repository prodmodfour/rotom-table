<script setup lang="ts">
import { computed } from 'vue'
import type { SpriteVisualBounds } from '~/types/pokemon'
import { getSpriteVisualBoundsFrameTranslation } from '~/utils/spriteVisualBounds'

const props = defineProps<{
  species: string
  spriteUrl: string | null
  visualBounds?: SpriteVisualBounds | null
}>()

const spriteVisualOffsetStyle = computed(() => {
  const translation = getSpriteVisualBoundsFrameTranslation(props.visualBounds)

  return {
    '--sprite-visual-translate-x': `${translation.xPercent}%`,
    '--sprite-visual-translate-y': `${translation.yPercent}%`,
  }
})
</script>

<template>
  <div class="sprite-frame" :style="spriteVisualOffsetStyle">
    <div class="sprite-frame__inner">
      <img
        v-if="spriteUrl"
        :src="spriteUrl"
        :alt="species"
      />
      <span v-else class="sprite-missing">no sprite</span>
    </div>
    <span class="bracket bracket--tl" />
    <span class="bracket bracket--tr" />
    <span class="bracket bracket--bl" />
    <span class="bracket bracket--br" />
  </div>
</template>
