<script setup lang="ts">
import type { PtuMove } from '~/types/ptuReference'

defineProps<{
  move: PtuMove
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="move.name">
      <template #pills>
        <TypeBadge v-if="move.type" :type="move.type" size="md" />
        <DamageClassBadge v-if="move.damage_class" :category="move.damage_class" size="md" />
        <span v-if="move.frequency" class="badge">{{ move.frequency }}</span>
      </template>
    </ReferenceDetailHeading>

    <dl class="stat-strip">
      <div v-if="move.damage_base != null"><dt>Damage Base</dt><dd>{{ move.damage_base }}</dd></div>
      <div v-if="move.damage_roll"><dt>Damage Roll</dt><dd>{{ move.damage_roll }}</dd></div>
      <div v-if="move.ac != null"><dt>AC</dt><dd>{{ move.ac }}</dd></div>
      <div v-if="move.range"><dt>Range</dt><dd>{{ move.range }}</dd></div>
    </dl>

    <ReferenceFieldBlock v-if="move.effect" title="Effect">
      <p>{{ move.effect }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
