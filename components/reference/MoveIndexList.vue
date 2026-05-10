<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import { referenceDetailPath } from '~/utils/reference/routes'
import type { PtuMove } from '~/types/ptuReference'

defineProps<{
  moves: PtuMove[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="move in moves"
      :key="move.name"
      :to="referenceDetailPath('move', toSlug(move.name))"
      class="ref-row"
    >
      <div class="ref-row__heading">
        <h2>{{ move.name }}</h2>
        <TypeBadge v-if="move.type" :type="move.type" size="sm" />
        <span v-if="move.frequency" class="ref-row__freq">{{ move.frequency }}</span>
      </div>
      <div class="ref-row__pills">
        <DamageClassBadge v-if="move.damage_class" :category="move.damage_class" size="xs" />
        <span v-if="move.damage_base != null" class="badge">DB {{ move.damage_base }}</span>
        <span v-if="move.ac != null" class="badge">AC {{ move.ac }}</span>
        <span v-if="move.range" class="badge">{{ move.range }}</span>
      </div>
      <p v-if="move.effect" class="ref-row__effect">{{ move.effect }}</p>
    </NuxtLink>
    <ReferenceEmptyState v-if="moves.length === 0" message="No moves match." />
  </main>
</template>
