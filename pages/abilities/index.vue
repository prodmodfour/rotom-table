<script setup lang="ts">
import { computed, ref } from 'vue'
import { abilities } from '~/data/ptuReference'
import { filterAbilitiesForIndex } from '~/utils/reference/abilityIndex'

useHead({ title: 'Abilities · Rotom Table' })

const searchTerm = ref('')

const filtered = computed(() => filterAbilitiesForIndex(abilities, { searchTerm: searchTerm.value }))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Abilities" :count="filtered.length" :total="abilities.length">
      <p class="ref-copy">
        PTU 1.05 ability list from
        <code>ptu-data/data/abilities.json</code>.
      </p>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search abilities"
        placeholder="Search by name, frequency, trigger, or effect…"
      />
    </ReferenceIndexHeader>

    <AbilityIndexList :abilities="filtered" />
  </div>
</template>


