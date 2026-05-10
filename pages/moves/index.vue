<script setup lang="ts">
import { computed, ref } from 'vue'
import { moves } from '~/data/ptuReference'
import { ALL_MOVE_TYPES_OPTION, buildMoveTypeOptions, filterMovesForIndex } from '~/utils/reference/moveIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Moves') })

const searchTerm = ref('')
const typeFilter = ref<string>(ALL_MOVE_TYPES_OPTION)

const allTypes = computed(() => buildMoveTypeOptions(moves))

const filtered = computed(() => filterMovesForIndex(moves, {
  searchTerm: searchTerm.value,
  type: typeFilter.value,
}))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Moves" :count="filtered.length" :total="moves.length">
      <p class="ref-copy">
        PTU 1.05 move list from
        <code>ptu-data/data/moves.json</code>.
      </p>

      <div class="moves-controls">
        <ReferenceSearchField
          v-model="searchTerm"
          label="Search moves"
          placeholder="Search by name, type, frequency, range, or effect…"
        />

        <ReferenceTypeFilter
          v-model:active-type="typeFilter"
          :types="allTypes"
          :all-option="ALL_MOVE_TYPES_OPTION"
          aria-label="Filter moves by type"
        />
      </div>
    </ReferenceIndexHeader>

    <MoveIndexList :moves="filtered" />
  </div>
</template>

<style scoped>
.moves-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

</style>
