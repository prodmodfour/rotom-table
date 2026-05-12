<script setup lang="ts">
import { toSlug } from '~~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import type { PtuFeature } from '~/types/ptuReference'

defineProps<{
  features: PtuFeature[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="feature in features"
      :key="feature.name"
      :to="referenceDetailPath('feature', toSlug(feature.name))"
      class="ref-row"
    >
      <div class="ref-row__heading">
        <h2>{{ feature.name }}</h2>
        <div class="row-tags">
          <span v-for="tag in feature.tags" :key="tag" class="badge tag-badge">{{ tag }}</span>
        </div>
      </div>
      <p v-if="feature.frequency" class="ref-row__freq">{{ feature.frequency }}</p>
      <p v-if="feature.prerequisites" class="ref-row__trigger">
        <span class="label">Prereq:</span> {{ feature.prerequisites }}
      </p>
      <p v-if="feature.effect" class="ref-row__effect">{{ feature.effect }}</p>
    </NuxtLink>
    <ReferenceEmptyState v-if="features.length === 0" message="No features match." />
  </main>
</template>

<style scoped>
.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
}
</style>
