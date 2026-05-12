<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'map' | 'sheet'
  tone?: 'default' | 'accent'
  imageUrl?: string | null
  imageAlt?: string
  fallbackLabel?: string
}>(), {
  size: 'sheet',
  tone: 'default',
  imageUrl: null,
  imageAlt: '',
  fallbackLabel: '',
})
</script>

<template>
  <div
    class="library-card-media"
    :class="[
      `library-card-media--${size}`,
      tone === 'accent' ? 'library-card-media--accent' : '',
    ]"
  >
    <img v-if="imageUrl" :src="imageUrl" :alt="imageAlt" />
    <span v-else-if="fallbackLabel" class="library-card-media__fallback">
      {{ fallbackLabel }}
    </span>
    <slot v-else />
  </div>
</template>

<style scoped>
.library-card-media {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.library-card-media--map {
  width: 64px;
  height: 64px;
}

.library-card-media--sheet {
  width: 72px;
  height: 72px;
  padding: 0.3rem;
}

.library-card-media--accent {
  color: var(--accent);
}

.library-card-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.library-card-media__fallback {
  color: var(--ink-faint);
  font-size: 1.4rem;
  font-weight: 700;
}
</style>
