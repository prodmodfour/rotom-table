<script setup lang="ts">
import { computed, ref } from 'vue'
import { abilities } from '~~/data/ptuReference'
import { filterAbilitiesForIndex } from '~/utils/reference/abilityIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Abilities') })

const searchTerm = ref('')

const filtered = computed(() => filterAbilitiesForIndex(abilities, { searchTerm: searchTerm.value }))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search abilities"
        placeholder="Search by name, frequency, trigger, or effect…"
      />
    </ReferenceIndexHeader>

    <AbilityIndexList :abilities="filtered" />
  </div>
</template>


