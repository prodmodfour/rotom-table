<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import type { PtuCapability } from '~/types/ptuReference'

defineProps<{
  capabilities: readonly PtuCapability[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="cap in capabilities"
      :key="cap.name"
      :to="referenceDetailPath('capability', toSlug(cap.name))"
      class="ref-row capability-row"
    >
      <CapabilityArt :name="cap.name" size="sm" class="capability-row__art" />
      <div class="capability-row__body">
        <div class="ref-row__heading">
          <h2>{{ cap.name }}</h2>
        </div>
        <p v-if="cap.effect" class="ref-row__effect">{{ cap.effect }}</p>
      </div>
    </NuxtLink>
    <ReferenceEmptyState v-if="capabilities.length === 0" message="No capabilities match." />
  </main>
</template>

<style scoped>
.capability-row {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.85rem;
  min-height: 108px;
}

.capability-row__art {
  flex: 0 0 auto;
  margin-top: 0.05rem;
}

.capability-row__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

@media (max-width: 520px) {
  .ref-list {
    grid-template-columns: 1fr;
  }

  .capability-row {
    gap: 0.65rem;
    padding: 0.75rem;
  }
}
</style>
