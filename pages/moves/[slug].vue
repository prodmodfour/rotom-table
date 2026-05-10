<script setup lang="ts">
import { computed } from 'vue'
import { moveBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const move = computed(() => moveBySlug.get(slug.value) ?? null)
const movesPath = referenceIndexPath('move')
const movesBackLabel = referenceAllBackLabel('move')
const movesNotFoundBackLabel = referenceNotFoundBackLabel('move')

useHead(() => ({
  title: referenceDetailTitle(move.value?.name, 'Moves', 'Move not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="movesPath" :back-label="movesBackLabel">
    <MoveDetailArticle v-if="move" :move="move" />

    <ReferenceNotFoundCard
      v-else
      title="Move not found"
      :slug="slug"
      :back-to="movesPath"
      :back-label="movesNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
