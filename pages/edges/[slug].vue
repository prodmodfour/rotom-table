<script setup lang="ts">
import { computed } from 'vue'
import { edgeBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const edge = computed(() => edgeBySlug.get(slug.value) ?? null)

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
      :slug="slug"
      back-to="/edges"
      back-label="← Back to all edges"
    />
  </ReferenceDetailShell>
</template>
