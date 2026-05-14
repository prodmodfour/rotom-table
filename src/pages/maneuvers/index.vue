<script setup lang="ts">
import { computed, ref } from 'vue'
import { maneuvers } from '~~/data/ptuReference'
import { buildManeuverActionOptions, filterManeuversForIndex } from '~/utils/reference/maneuverIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Maneuvers') })

const searchTerm = ref('')
const actionFilter = ref<string | null>(null)

const actionOptions = computed(() => buildManeuverActionOptions(maneuvers))

const filtered = computed(() => filterManeuversForIndex(maneuvers, {
  searchTerm: searchTerm.value,
  action: actionFilter.value,
}))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Maneuvers" :count="filtered.length" :total="maneuvers.length">
      <p class="ref-copy">
        PTU 1.05 combat maneuvers from
        <code>ptu-data/data/maneuvers.json</code>.
      </p>

      <div class="maneuvers-controls">
        <ReferenceSearchField
          v-model="searchTerm"
          label="Search maneuvers"
          placeholder="Search by name, action, range, trigger, or effect…"
        />

        <ReferenceSelectField
          v-model="actionFilter"
          label="Action"
          :options="actionOptions"
        />
      </div>
    </ReferenceIndexHeader>

    <ManeuverIndexList :maneuvers="filtered" />
  </div>
</template>

<style scoped>
.maneuvers-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem);
  gap: 0.5rem;
}

@media (max-width: 720px) {
  .maneuvers-controls {
    grid-template-columns: 1fr;
  }
}
</style>
