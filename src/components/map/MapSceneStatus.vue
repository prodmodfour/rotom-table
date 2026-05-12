<script setup lang="ts">
import { mapLibraryPath } from '~/utils/mapRoutes'
import type { MapSaveStatus } from '~/composables/useEditableMap'

defineProps<{
  status: MapSaveStatus
  error: string | null
  slug: string
  loadingText?: string
}>()
</script>

<template>
  <div v-if="status === 'loading'" class="scene-loading">{{ loadingText ?? 'Loading map…' }}</div>
  <div v-else-if="status === 'not-found'" class="scene-loading">
    <p>Map <code>{{ slug }}</code> not found.</p>
    <NuxtLink :to="mapLibraryPath()" class="back-link">← Back to maps</NuxtLink>
  </div>
  <div v-else class="scene-loading">
    <p>{{ error ?? 'Could not load map.' }}</p>
  </div>
</template>

<style scoped>
.scene-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--ink-muted);
  background: var(--paper);
  font-style: italic;
  gap: 0.6rem;
  text-align: center;
}

.back-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.back-link:hover {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
}
</style>
