<script setup lang="ts">
import { toSlug } from '~/data/ptuReference'
import type { PtuEdge } from '~/types/ptuReference'

defineProps<{
  edges: PtuEdge[]
}>()
</script>

<template>
  <main class="ref-list">
    <NuxtLink
      v-for="edge in edges"
      :key="edge.name"
      :to="`/edges/${toSlug(edge.name)}`"
      class="ref-row"
    >
      <div class="ref-row__heading">
        <h2>{{ edge.name }}</h2>
      </div>
      <p v-if="edge.prerequisites" class="ref-row__trigger">
        <span class="label">Prereq:</span> {{ edge.prerequisites }}
      </p>
      <p v-if="edge.effect" class="ref-row__effect">{{ edge.effect }}</p>
    </NuxtLink>
    <ReferenceEmptyState v-if="edges.length === 0" message="No edges match." />
  </main>
</template>
