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
      <EdgeDetailArticle v-if="edge" :edge="edge" />

      <ReferenceNotFoundCard
        v-else
        title="Edge not found"
        :slug="route.params.slug"
        back-to="/edges"
        back-label="← Back to all edges"
      />
  </ReferenceDetailShell>
</template>
