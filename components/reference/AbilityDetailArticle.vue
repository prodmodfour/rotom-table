<script setup lang="ts">
import type { PtuAbility } from '~/types/ptuReference'

defineProps<{
  ability: PtuAbility
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="ability.name">
      <template #pills>
        <span v-if="ability.frequency" class="badge">{{ ability.frequency }}</span>
      </template>
    </ReferenceDetailHeading>

    <ReferenceFieldBlock v-if="ability.trigger" title="Trigger">
      <p>{{ ability.trigger }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="ability.effect" title="Effect">
      <p>{{ ability.effect }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
