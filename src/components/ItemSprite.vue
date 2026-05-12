<script setup lang="ts">
import { computed } from 'vue'
import { itemSpriteUrl, type ItemSpriteInput } from '~/utils/itemSprites'

const props = withDefaults(defineProps<{
  item?: ItemSpriteInput
  alt?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>(), {
  item: null,
  alt: '',
  size: 'md',
})

const src = computed(() => itemSpriteUrl(props.item))
const isDecorative = computed(() => props.alt === '')
</script>

<template>
  <img
    v-if="src"
    class="item-sprite"
    :class="`item-sprite--${size}`"
    :src="src"
    :alt="alt"
    :aria-hidden="isDecorative ? 'true' : undefined"
    loading="lazy"
    decoding="async"
  />
</template>

<style scoped>
.item-sprite {
  display: inline-block;
  flex: 0 0 auto;
  width: var(--item-sprite-size, 32px);
  height: var(--item-sprite-size, 32px);
  object-fit: contain;
  image-rendering: pixelated;
  vertical-align: middle;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45));
}

.item-sprite--xs { --item-sprite-size: 18px; }
.item-sprite--sm { --item-sprite-size: 24px; }
.item-sprite--md { --item-sprite-size: 32px; }
.item-sprite--lg { --item-sprite-size: 40px; }
.item-sprite--xl { --item-sprite-size: 56px; }
</style>
