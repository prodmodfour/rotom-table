<script setup lang="ts">
import {
  initiativeSpriteFrameStyle,
  type InitiativeRow,
} from '~/composables/map-editor/useInitiativeTracker'

type InitiativeTokenSpriteEntry = Pick<InitiativeRow, 'name' | 'sprite'>

defineProps<{
  entry: InitiativeTokenSpriteEntry
}>()
</script>

<template>
  <span class="initiative-row__sprite" aria-hidden="true">
    <span
      v-if="entry.sprite.isSpriteSheet && entry.sprite.url"
      class="initiative-row__sprite-frame"
      :style="initiativeSpriteFrameStyle(entry)"
    />
    <img
      v-else-if="entry.sprite.url"
      :src="entry.sprite.url"
      alt=""
      draggable="false"
    />
    <span v-else class="initiative-row__sprite-fallback">
      {{ entry.name.slice(0, 1) }}
    </span>
  </span>
</template>

<style scoped>
.initiative-row__sprite {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 40px;
  overflow: hidden;
  border-radius: 8px;
}

.initiative-row__sprite-frame {
  display: block;
  flex: 0 0 auto;
  background-position: left top;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  transform-origin: center;
}

.initiative-row__sprite img {
  display: block;
  max-width: 34px;
  max-height: 34px;
  object-fit: contain;
  image-rendering: pixelated;
}

.initiative-row__sprite-fallback {
  color: var(--ink-bright);
  font-weight: 800;
  text-transform: uppercase;
}
</style>
