<script setup lang="ts">
import type { PtuRule } from '~/types/ptuReference'

defineProps<{
  rule: PtuRule
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="rule.name">
      <template #pills>
        <span class="badge">{{ rule.category }}</span>
        <span v-if="rule.source" class="badge">{{ rule.source }}</span>
      </template>
    </ReferenceDetailHeading>

    <ReferenceFieldBlock v-if="rule.text" title="Rule Text">
      <p>{{ rule.text }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
