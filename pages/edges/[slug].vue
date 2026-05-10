<script setup lang="ts">
import { computed } from 'vue'
import { edgeBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'

const route = useRoute()

const edge = computed(() => edgeBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: referenceDetailTitle(edge.value?.name, 'Edges', 'Edge not found'),
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
