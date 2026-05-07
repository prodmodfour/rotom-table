<script setup lang="ts">
import { computed, ref } from 'vue'
import { rules, toSlug } from '~/data/ptuReference'

useHead({ title: 'Rules · Rotom Table' })

const searchTerm = ref('')
const categoryFilter = ref<string | null>(null)
const normalize = (value: string) => value.trim().toLowerCase()

const categoryCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const rule of rules) {
    counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }))
})

const filtered = computed(() => {
  const query = normalize(searchTerm.value)
  return rules.filter((rule) => {
    if (categoryFilter.value && rule.category !== categoryFilter.value) return false
    if (!query) return true

    const haystacks = [
      rule.name,
      rule.category,
      rule.text ?? '',
      rule.source ?? '',
      ...(rule.aliases ?? []),
    ]
    return haystacks.some((value) => normalize(value).includes(query))
  })
})

const groupedRules = computed(() => {
  const groups = new Map<string, typeof rules>()
  for (const rule of filtered.value) {
    const group = groups.get(rule.category) ?? []
    group.push(rule)
    groups.set(rule.category, group)
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, entries]) => ({ category, entries }))
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
          <h1>Rules</h1>
          <span class="badge">{{ filtered.length }} of {{ rules.length }}</span>
        </div>
        <p class="ref-copy">
          PTU rules and house rules from <code>ptu-data/data/rules.json</code>.
          Pick a category to filter, or search by name, source, or rule text.
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

        <label class="search-field">
          <span class="sr-only">Search rules</span>
          <input
            v-model.trim="searchTerm"
            type="search"
            placeholder="Search by name, category, source, or text…"
          />
        </label>
      </section>
    </header>

    <main class="ref-list rules-list">
      <section
        v-for="group in groupedRules"
        :key="group.category"
        class="rule-group"
      >
        <h2>{{ group.category }}</h2>
        <NuxtLink
          v-for="rule in group.entries"
          :key="rule.name"
          :to="`/rules/${toSlug(rule.name)}`"
          class="ref-row rule-row"
        >
          <div class="ref-row__heading">
            <h3>{{ rule.name }}</h3>
            <span v-if="rule.source" class="ref-row__freq">{{ rule.source }}</span>
          </div>
          <p v-if="rule.text" class="ref-row__effect">{{ rule.text }}</p>
        </NuxtLink>
      </section>
      <p v-if="filtered.length === 0" class="empty-state">No rules match.</p>
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

.rules-list {
  display: grid;
  gap: 1rem;
}

.rule-group {
  display: grid;
  gap: 0.55rem;
}

.rule-group > h2 {
  margin: 0;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.rule-row h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
}
</style>
