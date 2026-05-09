<script setup lang="ts">
import { computed, ref } from 'vue'
import { items, toSlug } from '~/data/ptuReference'
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
        <label class="search-field">
          <span class="sr-only">Search items</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, cost, section, source, or effect…"
          />
        </label>

        <label class="select-field">
          <span>Section</span>
          <select v-model="sectionFilter">
            <option :value="null">All sections</option>
            <option
              v-for="{ section, count } in sectionCounts"
              :key="section"
              :value="section"
            >
              {{ section }} ({{ count }})
            </option>
          </select>
        </label>
      </div>
    </ReferenceIndexHeader>

    <main class="ref-list">
      <NuxtLink
        v-for="item in filtered"
        :key="item.name"
        :to="`/items/${toSlug(item.name)}`"
        class="ref-row"
      >
        <div class="item-row__top">
          <ItemSprite :item="item" size="lg" />
          <div class="item-row__summary">
            <div class="ref-row__heading">
              <h2>{{ item.name }}</h2>
              <div class="row-tags">
                <span v-for="category in item.categories" :key="category" class="badge tag-badge">
                  {{ category }}
                </span>
              </div>
            </div>

            <div class="ref-row__pills">
              <span v-for="cost in item.costs.slice(0, 2)" :key="cost" class="badge cost-badge">
                {{ cost }}
              </span>
              <span v-if="item.costs.length > 2" class="badge cost-badge">
                +{{ item.costs.length - 2 }} costs
              </span>
              <span v-for="section in item.sections.slice(0, 2)" :key="section" class="badge section-badge">
                {{ section }}
              </span>
              <span v-if="item.sections.length > 2" class="badge section-badge">
                +{{ item.sections.length - 2 }} sections
              </span>
            </div>
          </div>
        </div>

        <p v-if="item.effects.length" class="ref-row__effect">
          {{ item.effects.join(' ') }}
        </p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No items match.</p>
    </main>
  </div>
</template>

<style scoped>
.item-controls {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(220px, 320px);
  gap: 0.55rem;
  align-items: end;
}

.select-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.select-field span {
  color: var(--ink-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.select-field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.7rem 0.85rem;
  outline: none;
}

.select-field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.item-row__top {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.item-row__summary {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-badge {
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
}

.cost-badge,
.section-badge {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-badge {
  background: var(--paper-inset);
  color: var(--ink-soft);
  border: 1px solid var(--rule-soft);
}

@media (max-width: 720px) {
  .item-controls {
    grid-template-columns: 1fr;
  }
}
</style>
