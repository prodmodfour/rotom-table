<script setup lang="ts">
import type { PtuEdge } from '~/types/ptuReference'

defineProps<{
  edge: PtuEdge
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="edge.name" />

    <ReferenceFieldBlock v-if="edge.prerequisites" title="Prerequisites">
      <p>{{ edge.prerequisites }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="edge.effect" title="Effect">
      <p>{{ edge.effect }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
