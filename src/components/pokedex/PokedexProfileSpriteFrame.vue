<script setup lang="ts">
defineProps<{
  species: string
  spriteUrl: string | null
}>()
</script>

<template>
  <div class="sprite-frame">
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
