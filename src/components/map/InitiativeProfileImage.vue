<script setup lang="ts">
import { computed } from 'vue'
import InitiativeTokenSprite from '~/components/map/InitiativeTokenSprite.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

type InitiativeProfileImageEntry = Pick<InitiativeRow, 'name' | 'profileUrl' | 'sprite'> & Partial<Pick<InitiativeRow, 'initiativeScore'>>

const props = withDefaults(defineProps<{
  entry: InitiativeProfileImageEntry
  showInitiativeScore?: boolean
}>(), {
  showInitiativeScore: false,
})

const initiativeScoreLabel = computed(() => {
  const score = props.entry.initiativeScore
  return typeof score === 'number' && Number.isFinite(score) ? `${Math.trunc(score)}` : ''
})
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
    <span
      v-if="showInitiativeScore && initiativeScoreLabel"
      class="initiative-profile-image__score"
    >
      {{ initiativeScoreLabel }}
    </span>
  </span>
</template>

<style scoped>
.initiative-profile-image {
  position: relative;
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

.initiative-profile-image__score {
  position: absolute;
  right: 0.18rem;
  bottom: 0.12rem;
  z-index: 2;
  display: block;
  color: var(--accent);
  font-size: clamp(0.58rem, 0.75vw, 0.72rem);
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 1px 2px color-mix(in srgb, var(--pokemon-black) 72%, transparent);
}
</style>
