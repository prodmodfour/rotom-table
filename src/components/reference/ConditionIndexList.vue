<script setup lang="ts">
import { toSlug } from '~~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import { conditionDisplayName, type PtuConditionRecord } from '~/utils/statusConditions'

defineProps<{
  conditions: readonly PtuConditionRecord[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="condition in conditions"
      :key="condition.name"
      :to="referenceDetailPath('condition', toSlug(condition.name))"
      class="ref-row condition-row"
    >
      <div class="ref-row__heading condition-row__heading">
        <ConditionTag :name="condition.name" size="sm" />
        <h2>{{ conditionDisplayName(condition.name) }}</h2>
        <span class="badge condition-row__category">{{ condition.category }}</span>
        <span v-if="condition.source" class="ref-row__freq">{{ condition.source }}</span>
      </div>
      <p v-if="condition.effect" class="ref-row__effect">
        {{ condition.effect }}
      </p>
    </NuxtLink>
    <ReferenceEmptyState v-if="conditions.length === 0" message="No conditions match." />
  </main>
</template>

<style scoped>
.condition-row__heading {
  align-items: center;
}

.condition-row__category {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
