<script setup lang="ts">
import { computed } from 'vue'
import { edgeBySlug } from '~~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const edge = computed(() => edgeBySlug.get(slug.value) ?? null)
const edgesPath = referenceIndexPath('edge')
const edgesBackLabel = referenceAllBackLabel('edge')
const edgesNotFoundBackLabel = referenceNotFoundBackLabel('edge')

useHead(() => ({
  title: referenceDetailTitle(edge.value?.name, 'Edges', 'Edge not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="edgesPath" :back-label="edgesBackLabel">
    <EdgeDetailArticle v-if="edge" :edge="edge" />

    <ReferenceNotFoundCard
      v-else
      title="Edge not found"
      :slug="slug"
      :back-to="edgesPath"
      :back-label="edgesNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
