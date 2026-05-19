<script setup lang="ts">
import { toSlug } from '~~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import { conditionDisplayName } from '~/utils/statusConditions'
import type { ConditionGroupForIndex } from '~/utils/reference/conditionIndex'

defineProps<{
  groups: ConditionGroupForIndex[]
  resultCount: number
}>()
</script>

<template>
  <main class="ref-list condition-list">
    <section
      v-for="group in groups"
      :key="group.category"
      class="condition-group"
    >
      <h2>{{ group.label }}</h2>
      <NuxtLink
        v-for="condition in group.conditions"
        :key="condition.name"
        :to="referenceDetailPath('condition', toSlug(condition.name))"
        class="ref-row condition-row"
      >
        <div class="ref-row__heading">
          <span class="condition-row__tag"><ConditionTag :name="condition.name" size="sm" /></span>
          <h3>{{ conditionDisplayName(condition.name) }}</h3>
          <span v-if="condition.source" class="ref-row__freq">{{ condition.source }}</span>
        </div>
        <p v-if="condition.effect" class="ref-row__effect">
          {{ condition.effect }}
        </p>
      </NuxtLink>
    </section>
    <ReferenceEmptyState v-if="resultCount === 0" message="No conditions match." />
  </main>
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
