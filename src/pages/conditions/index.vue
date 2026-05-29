<script setup lang="ts">
import { computed, ref } from 'vue'
import { conditionGroups, conditions } from '~/utils/statusConditions'
import { filterConditionsForIndex, groupFilteredConditions } from '~/utils/reference/conditionIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Conditions') })

const searchTerm = ref('')

const filtered = computed(() => filterConditionsForIndex(conditions, { searchTerm: searchTerm.value }))

const filteredByCategory = computed(() => groupFilteredConditions(conditionGroups, filtered.value))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search conditions"
        placeholder="Search by name, alias, category, source, or effect…"
      />
    </ReferenceIndexHeader>

    <ConditionIndexGroupedList
      :groups="filteredByCategory"
      :result-count="filtered.length"
    />
  </div>
</template>
