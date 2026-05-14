<script setup lang="ts">
import type { PtuManeuver } from '~/types/ptuReference'

defineProps<{
  maneuver: PtuManeuver
}>()
</script>

<template>
  <article class="panel-card">
    <ReferenceDetailHeading :title="maneuver.name">
      <template #pills>
        <span class="badge">{{ maneuver.category }}</span>
        <DamageClassBadge v-if="maneuver.maneuver_class" :category="maneuver.maneuver_class" size="md" />
        <span v-if="maneuver.source" class="badge">{{ maneuver.source }}</span>
      </template>
    </ReferenceDetailHeading>

    <dl class="stat-strip">
      <div v-if="maneuver.action"><dt>Action</dt><dd>{{ maneuver.action }}</dd></div>
      <div v-if="maneuver.ac != null"><dt>AC</dt><dd>{{ maneuver.ac }}</dd></div>
      <div v-if="maneuver.range"><dt>Range</dt><dd>{{ maneuver.range }}</dd></div>
    </dl>

    <ReferenceFieldBlock v-if="maneuver.trigger" title="Trigger">
      <p>{{ maneuver.trigger }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="maneuver.effect" title="Effect">
      <p>{{ maneuver.effect }}</p>
    </ReferenceFieldBlock>

    <ReferenceFieldBlock v-if="maneuver.special" title="Special">
      <p>{{ maneuver.special }}</p>
    </ReferenceFieldBlock>
  </article>
</template>
