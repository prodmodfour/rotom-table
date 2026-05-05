<script setup lang="ts">
import { computed, ref } from 'vue'
import { items, toSlug } from '~/data/ptuReference'

useHead({ title: 'Items · Rotom Table' })

const searchTerm = ref('')
const categoryFilter = ref<string | null>(null)
const sectionFilter = ref<string | null>(null)

const normalize = (value: string) => value.trim().toLowerCase()

const categoryCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const category of item.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }))
})

const sectionCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const section of item.sections) {
      counts.set(section, (counts.get(section) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([section, count]) => ({ section, count }))
})

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  return items.filter((item) => {
    if (categoryFilter.value && !item.categories.includes(categoryFilter.value)) return false
    if (sectionFilter.value && !item.sections.includes(sectionFilter.value)) return false
    if (!query) return true

    const haystacks = [
      item.name,
      item.source,
      ...item.categories,
      ...item.sections,
      ...item.costs,
      ...item.effects,
      ...item.aliases,
      ...item.notes,
    ]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})

const toggleCategory = (category: string) => {
  categoryFilter.value = categoryFilter.value === category ? null : category
}
</script>

<template>
  <div class="ref-index">
    <header class="ref-header">
      <AppNavigation />
      <section class="panel-card">
        <div class="ref-heading">
          <h1>Items</h1>
          <span class="badge">{{ filtered.length }} of {{ items.length }}</span>
        </div>
        <p class="ref-copy">
          PTU gear, medicine, Poké Balls, TMs, Held Items, and equipment from
          <code>ptu-data/data/items.json</code>. Pick a category or section, or search by
          name, alias, cost, source, or effect.
        </p>

        <div class="category-row">
          <button
            v-for="{ category, count } in categoryCounts"
            :key="category"
            type="button"
            class="category-chip"
            :class="{ active: categoryFilter === category }"
            @click="toggleCategory(category)"
          >
            {{ category }} <span class="category-count">{{ count }}</span>
          </button>
        </div>

        <div class="item-controls">
          <label class="search-field">
            <span class="sr-only">Search items</span>
            <input
              v-model.trim="searchTerm"
              type="search"
              placeholder="Search by name, alias, cost, section, source, or effect…"
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
      </section>
    </header>

    <main class="ref-list">
      <NuxtLink
        v-for="item in filtered"
        :key="item.name"
        :to="`/items/${toSlug(item.name)}`"
        class="ref-row"
      >
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

        <p v-if="item.aliases.length" class="ref-row__trigger">
          <span class="label">Aliases:</span> {{ item.aliases.join(', ') }}
        </p>
        <p v-if="item.effects.length" class="ref-row__effect">
          {{ item.effects.join(' ') }}
        </p>
      </NuxtLink>
      <p v-if="filtered.length === 0" class="empty-state">No items match.</p>
    </main>
  </div>
</template>

<style scoped>
.category-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.4rem;
  margin: 0.45rem 0 0.7rem;
}

.category-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0.18rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.category-chip:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.category-chip.active {
  background: var(--paper-active);
  border-color: var(--rule-active);
  color: var(--ink-bright);
}

.category-count {
  opacity: 0.6;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

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
