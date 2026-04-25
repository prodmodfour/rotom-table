<script setup lang="ts">
import { computed } from 'vue'
import { edgeBySlug } from '~/data/ptuReference'

const route = useRoute()

const edge = computed(() => edgeBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: edge.value
    ? `${edge.value.name} · Edges`
    : 'Edge not found · Rotom Table',
}))
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/edges" class="back-link">← All edges</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="edge" class="panel-card">
        <div class="detail-heading">
          <h1>{{ edge.name }}</h1>
        </div>

        <section v-if="edge.prerequisites" class="field-block">
          <h3>Prerequisites</h3>
          <p>{{ edge.prerequisites }}</p>
        </section>

        <section v-if="edge.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ edge.effect }}</p>
        </section>
      </article>

      <article v-else class="panel-card">
        <h1>Edge not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/edges" class="back-link">← Back to all edges</NuxtLink>
      </article>
    </main>
  </div>
</template>
