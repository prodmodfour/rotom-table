<script setup lang="ts">
import { toSlug } from '~~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import type { PtuManeuver } from '~/types/ptuReference'

defineProps<{
  maneuvers: PtuManeuver[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="maneuver in maneuvers"
      :key="maneuver.name"
      :to="referenceDetailPath('maneuver', toSlug(maneuver.name))"
      class="ref-row"
    >
      <div class="ref-row__heading">
        <h2>{{ maneuver.name }}</h2>
        <span v-if="maneuver.action" class="ref-row__freq">{{ maneuver.action }}</span>
      </div>
      <div class="ref-row__pills">
        <DamageClassBadge v-if="maneuver.maneuver_class" :category="maneuver.maneuver_class" size="xs" />
        <span v-if="maneuver.ac != null" class="badge">AC {{ maneuver.ac }}</span>
        <span v-if="maneuver.range" class="badge">{{ maneuver.range }}</span>
        <span v-if="maneuver.trigger" class="badge">Trigger</span>
      </div>
      <p v-if="maneuver.effect" class="ref-row__effect">{{ maneuver.effect }}</p>
    </NuxtLink>
    <ReferenceEmptyState v-if="maneuvers.length === 0" message="No maneuvers match." />
  </main>
</template>
