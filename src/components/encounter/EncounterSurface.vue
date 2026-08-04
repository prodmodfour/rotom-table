<script setup lang="ts">
import type { EncounterVisualLayer, EncounterVisualState } from '#shared/encounterWorkspace/designTokens'

withDefaults(defineProps<{
  as?: 'article' | 'aside' | 'div' | 'section'
  label?: string
  layer?: EncounterVisualLayer
  elevation?: 0 | 1 | 2 | 3 | 4 | 5
  state?: EncounterVisualState
  notched?: boolean
}>(), {
  as: 'section',
  label: undefined,
  layer: 'persistent',
  elevation: 1,
  state: 'idle',
  notched: false,
})
</script>

<template>
  <component
    :is="as"
    class="rt-surface"
    :class="{ 'rt-surface--notched': notched }"
    :aria-label="label"
    :data-rt-elevation="elevation"
    :data-rt-layer="layer"
    :data-rt-state="state"
  >
    <slot />
  </component>
</template>
