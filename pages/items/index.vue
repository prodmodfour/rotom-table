<script setup lang="ts">
import { computed, ref } from 'vue'
import { items } from '~/data/ptuReference'
import {
  buildItemCategoryCounts,
  buildItemSectionCounts,
  filterItemsForIndex,
} from '~/utils/reference/itemIndex'

useHead({ title: 'Items · Rotom Table' })

const searchTerm = ref('')
const categoryFilter = ref<string | null>(null)
const sectionFilter = ref<string | null>(null)

const categoryCounts = computed(() => buildItemCategoryCounts(items))
const sectionCounts = computed(() => buildItemSectionCounts(items))
const sectionOptions = computed(() => [
  { value: null, label: 'All sections' },
  ...sectionCounts.value.map(({ section, count }) => ({
    value: section,
    label: `${section} (${count})`,
  })),
])
const categoryChips = computed(() => categoryCounts.value.map(({ category, count }) => ({
  key: category,
  label: category,
  count,
})))

const filtered = computed(() => filterItemsForIndex(items, {
  searchTerm: searchTerm.value,
  category: categoryFilter.value,
  section: sectionFilter.value,
}))

const toggleCategory = (category: string) => {
  categoryFilter.value = categoryFilter.value === category ? null : category
}
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Items" :count="filtered.length" :total="items.length">
      <p class="ref-copy">
        PTU gear, medicine, Poké Balls, TMs, Held Items, and equipment from
        <code>ptu-data/data/items.json</code>. Pick a category or section, or search by
        name, cost, source, or effect.
      </p>

      <ReferenceFilterChips
        :chips="categoryChips"
        :active-key="categoryFilter"
        aria-label="Filter items by category"
        @select="toggleCategory"
      />

      <div class="item-controls">
        <ReferenceSearchField
          v-model="searchTerm"
          label="Search items"
          placeholder="Search by name, cost, section, source, or effect…"
        />

        <ReferenceSelectField
          v-model="sectionFilter"
          label="Section"
          :options="sectionOptions"
        />
      </div>
    </ReferenceIndexHeader>

    <ItemIndexList :items="filtered" />
  </div>
</template>

<style scoped>
.item-controls {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(220px, 320px);
  gap: 0.55rem;
  align-items: end;
}

@media (max-width: 720px) {
  .item-controls {
    grid-template-columns: 1fr;
  }
}
</style>
