<script setup lang="ts">
import { computed, ref } from 'vue'
import { edges } from '~/data/ptuReference'
import { filterEdgesForIndex } from '~/utils/reference/edgeIndex'

useHead({ title: 'Edges · Rotom Table' })

const searchTerm = ref('')

const filtered = computed(() => filterEdgesForIndex(edges, { searchTerm: searchTerm.value }))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Edges" :count="filtered.length" :total="edges.length">
      <p class="ref-copy">
        Trainer Edges parsed from <code>core/03-skills-edges-and-features.md</code>.
        Each is a small character-building unit with just Prerequisites and an
        Effect — think Skill Edges, Crafting Edges, and Combat Edges.
      </p>

      <ReferenceSearchField
        v-model="searchTerm"
        label="Search edges"
        placeholder="Search by name, prereq, or effect…"
      />
    </ReferenceIndexHeader>

    <EdgeIndexList :edges="filtered" />
  </div>
</template>
