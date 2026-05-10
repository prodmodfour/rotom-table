<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import type { RuleGroup } from '~/utils/reference/ruleIndex'

defineProps<{
  groups: RuleGroup[]
  resultCount: number
}>()
</script>

<template>
  <main class="ref-list rules-list">
    <section
      v-for="group in groups"
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
    <ReferenceEmptyState v-if="resultCount === 0" message="No rules match." />
  </main>
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
