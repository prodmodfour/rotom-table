<script setup lang="ts">
import { computed, ref } from 'vue'
import { moves, toSlug } from '~/data/ptuReference'
import { ALL_MOVE_TYPES_OPTION, buildMoveTypeOptions, filterMovesForIndex } from '~/utils/reference/moveIndex'

useHead({ title: 'Moves · Rotom Table' })

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

    <main class="ref-list">
      <NuxtLink
        v-for="move in filtered"
        :key="move.name"
        :to="`/moves/${toSlug(move.name)}`"
        class="ref-row"
      >
        <div class="ref-row__heading">
          <h2>{{ move.name }}</h2>
          <TypeBadge v-if="move.type" :type="move.type" size="sm" />
          <span v-if="move.frequency" class="ref-row__freq">{{ move.frequency }}</span>
        </div>
        <div class="ref-row__pills">
          <DamageClassBadge v-if="move.damage_class" :category="move.damage_class" size="xs" />
          <span v-if="move.damage_base != null" class="badge">DB {{ move.damage_base }}</span>
          <span v-if="move.ac != null" class="badge">AC {{ move.ac }}</span>
          <span v-if="move.range" class="badge">{{ move.range }}</span>
        </div>
        <p v-if="move.effect" class="ref-row__effect">{{ move.effect }}</p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No moves match.</p>
    </main>
  </div>
</template>

<style scoped>
.moves-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

</style>
