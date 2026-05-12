<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import { mapLibraryPath } from '~/utils/mapRoutes'
import type { SaveStatus } from '~/composables/useEditableSheet'

defineProps<{
  saveIndicatorStatus: SaveStatus | null
  error: string | null
}>()
</script>

<template>
  <AppNavigation />

  <div class="header-row">
    <NuxtLink :to="mapLibraryPath()" class="back-link">← All maps</NuxtLink>
    <SaveIndicator
      v-if="saveIndicatorStatus"
      :status="saveIndicatorStatus"
      :error="error"
    />
  </div>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0 0.25rem;
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
