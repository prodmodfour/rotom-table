<script setup lang="ts">
import type { PtuCondition } from '~/types/ptuReference'

defineProps<{
  condition: PtuCondition
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="condition.name">
      <template #pills>
        <ConditionTag :name="condition.name" size="md" />
        <span class="badge">{{ condition.category }}</span>
        <span v-if="condition.source" class="badge">{{ condition.source }}</span>
      </template>
    </ReferenceDetailHeading>

    <ReferenceFieldBlock v-if="condition.aliases?.length" title="Aliases">
      <p>{{ condition.aliases.join(', ') }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="condition.effect" title="Effect">
      <p>{{ condition.effect }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
