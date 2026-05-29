<script setup lang="ts">
import { computed, ref } from 'vue'
import { rules } from '~~/data/ptuReference'
import {
  buildRuleCategoryCounts,
  filterRulesForIndex,
  groupRulesForIndex,
  toggledRuleCategory,
} from '~/utils/reference/ruleIndex'
import { referenceIndexTitle } from '~/utils/reference/pageTitles'

useHead({ title: referenceIndexTitle('Rules') })

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
    <ReferenceIndexHeader>
      <ReferenceFilterChips
        :chips="categoryChips"
        :active-key="categoryFilter"
        aria-label="Filter rules by category"
        @select="toggleCategory"
      />

      <ReferenceSearchField
        v-model="searchTerm"
        label="Search rules"
        placeholder="Search by name, category, source, or text…"
      />
    </ReferenceIndexHeader>

    <RuleIndexGroupedList :groups="groupedRules" :result-count="filtered.length" />
  </div>
</template>
