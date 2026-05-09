<script setup lang="ts">
import { computed, ref } from 'vue'
import { toSlug } from '~/data/ptuReference'
import { conditionGroups, conditions } from '~/utils/statusConditions'
import { filterConditionsForIndex, groupFilteredConditions } from '~/utils/reference/conditionIndex'

useHead({ title: 'Conditions · Rotom Table' })

const searchTerm = ref('')

const filtered = computed(() => filterConditionsForIndex(conditions, { searchTerm: searchTerm.value }))

const filteredByCategory = computed(() => groupFilteredConditions(conditionGroups, filtered.value))
</script>

<template>
  <div class="ref-index">
    <ReferenceIndexHeader title="Conditions" :count="filtered.length" :total="conditions.length">
      <p class="ref-copy">
        PTU status conditions and afflictions from
        <code>ptu-data/data/conditions.json</code>.
      </p>
      <ReferenceSearchField
        v-model="searchTerm"
        label="Search conditions"
        placeholder="Search by name, alias, category, source, or effect…"
      />
    </ReferenceIndexHeader>

    <main class="ref-list condition-list">
      <section
        v-for="group in filteredByCategory"
        :key="group.category"
        class="condition-group"
      >
        <h2>{{ group.label }}</h2>
        <NuxtLink
          v-for="condition in group.conditions"
          :key="condition.name"
          :to="`/conditions/${toSlug(condition.name)}`"
          class="ref-row condition-row"
        >
          <div class="ref-row__heading">
            <span class="condition-row__tag"><ConditionTag :name="condition.name" size="sm" /></span>
            <h3>{{ condition.name }}</h3>
            <span v-if="condition.source" class="ref-row__freq">{{ condition.source }}</span>
          </div>
          <p v-if="condition.effect" class="ref-row__effect">
            {{ condition.effect }}
          </p>
        </NuxtLink>
      </section>
      <p v-if="filtered.length === 0" class="empty-state">No conditions match.</p>
    </main>
  </div>
</template>

<style scoped>
.condition-list {
  display: grid;
  gap: 1rem;
}

.condition-group {
  display: grid;
  gap: 0.55rem;
}

.condition-group > h2 {
  margin: 0;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.condition-row__tag {
  display: inline-flex;
}

.condition-row h3 {
  margin: 0;
}
</style>
