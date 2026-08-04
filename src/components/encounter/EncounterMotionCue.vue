<script setup lang="ts">
withDefaults(defineProps<{
  cue: 'pulse' | 'lock' | 'sweep' | 'travel' | 'impact' | 'settle' | 'correct'
  replayKey?: string | number
  decorative?: boolean
}>(), {
  replayKey: 0,
  decorative: false,
})
</script>

<template>
  <div
    :key="replayKey"
    class="rt-motion-cue"
    :data-rt-motion="cue"
    :aria-hidden="decorative || undefined"
  >
    <slot />
  </div>
</template>
