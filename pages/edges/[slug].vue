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
  <ReferenceDetailShell back-to="/edges" back-label="← All edges">
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

      <ReferenceNotFoundCard
        v-else
        title="Edge not found"
        :slug="route.params.slug"
        back-to="/edges"
        back-label="← Back to all edges"
      />
  </ReferenceDetailShell>
</template>
