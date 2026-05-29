<script setup lang="ts">
import { computed, ref } from 'vue'
import { edges } from '~~/data/ptuReference'
import { filterEdgesForIndex } from '~/utils/reference/edgeIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Edges') })

const searchTerm = ref('')

const filtered = computed(() => filterEdgesForIndex(edges, { searchTerm: searchTerm.value }))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search edges"
        placeholder="Search by name, prereq, or effect…"
      />
    </ReferenceIndexHeader>

    <EdgeIndexList :edges="filtered" />
  </div>
</template>
