<script setup lang="ts">
import { computed, ref } from 'vue'
import { rules, toSlug } from '~/data/ptuReference'
import {
  buildRuleCategoryCounts,
  filterRulesForIndex,
  groupRulesForIndex,
  toggledRuleCategory,
} from '~/utils/reference/ruleIndex'

useHead({ title: 'Rules · Rotom Table' })

const searchTerm = ref('')
const categoryFilter = ref<string | null>(null)

const categoryCounts = computed(() => buildRuleCategoryCounts(rules))
const categoryChips = computed(() => categoryCounts.value.map(({ category, count }) => ({
  key: category,
  label: category,
  count,
})))

const filtered = computed(() => filterRulesForIndex(rules, {
  category: categoryFilter.value,
  searchTerm: searchTerm.value,
}))

const groupedRules = computed(() => groupRulesForIndex(filtered.value))

const toggleCategory = (category: string) => {
  categoryFilter.value = toggledRuleCategory(categoryFilter.value, category)
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

        <ReferenceFilterChips
          :chips="categoryChips"
          :active-key="categoryFilter"
          aria-label="Filter rules by category"
          @select="toggleCategory"
        />

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
