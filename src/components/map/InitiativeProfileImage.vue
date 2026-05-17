<script setup lang="ts">
import InitiativeTokenSprite from '~/components/map/InitiativeTokenSprite.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  entry: InitiativeRow
}>()
</script>

<template>
  <span class="initiative-profile-image" aria-hidden="true">
    <img
      v-if="entry.profileUrl"
      :src="entry.profileUrl"
      alt=""
      draggable="false"
    />
    <InitiativeTokenSprite v-else :entry="entry" />
  </span>
</template>

<style scoped>
.initiative-profile-image {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.initiative-profile-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
</style>
