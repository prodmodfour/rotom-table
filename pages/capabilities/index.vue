<script setup lang="ts">
import { computed, ref } from 'vue'
import { capabilities, toSlug } from '~/data/ptuReference'
import { filterCapabilities } from '~/utils/reference/capabilityIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Capabilities') })

const searchTerm = ref('')
const filtered = computed(() => filterCapabilities(capabilities, searchTerm.value))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Capabilities" :count="filtered.length" :total="capabilities.length">
      <p class="ref-copy">
        Named PTU capabilities from <code>ptu-data/data/capabilities.json</code>.
        The numeric movement keywords (Overland, Sky, Swim, Levitate, Burrow,
        Jump, Power) are core mechanics and live in the rulebook itself.
      </p>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search capabilities"
        placeholder="Search by name or effect…"
      />
    </ReferenceIndexHeader>

    <main class="ref-list">
      <NuxtLink
        v-for="cap in filtered"
        :key="cap.name"
        :to="`/capabilities/${toSlug(cap.name)}`"
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
      <ReferenceEmptyState v-if="filtered.length === 0">No capabilities match.</ReferenceEmptyState>
    </main>
  </div>
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
