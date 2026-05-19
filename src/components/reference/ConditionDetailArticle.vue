<script setup lang="ts">
import { computed } from 'vue'
import type { PtuCondition } from '~/types/ptuReference'
import { conditionDisplayName } from '~/utils/statusConditions'

const props = defineProps<{
  condition: PtuCondition
}>()

const displayName = computed(() => conditionDisplayName(props.condition.name))
const displayAliases = computed(() => {
  const aliases = props.condition.aliases ?? []
  if (displayName.value === props.condition.name) return aliases
  return [props.condition.name, ...aliases.filter((alias) => alias !== displayName.value)]
})
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="displayName">
      <template #pills>
        <ConditionTag :name="condition.name" size="md" />
        <span class="badge">{{ condition.category }}</span>
        <span v-if="condition.source" class="badge">{{ condition.source }}</span>
      </template>
    </ReferenceDetailHeading>

    <ReferenceFieldBlock v-if="displayAliases.length" title="Aliases">
      <p>{{ displayAliases.join(', ') }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="condition.effect" title="Effect">
      <p>{{ condition.effect }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
