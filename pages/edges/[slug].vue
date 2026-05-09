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
        <ReferenceDetailHeading :title="edge.name" />

        <ReferenceFieldBlock v-if="edge.prerequisites" title="Prerequisites">
          <p>{{ edge.prerequisites }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="edge.effect" title="Effect">
          <p>{{ edge.effect }}</p>
        </ReferenceFieldBlock>
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
