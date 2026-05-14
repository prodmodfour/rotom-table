<script setup lang="ts">
import { computed } from 'vue'
import { maneuverBySlug } from '~~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const maneuver = computed(() => maneuverBySlug.get(slug.value) ?? null)
const maneuversPath = referenceIndexPath('maneuver')
const maneuversBackLabel = referenceAllBackLabel('maneuver')
const maneuversNotFoundBackLabel = referenceNotFoundBackLabel('maneuver')

useHead(() => ({
  title: referenceDetailTitle(maneuver.value?.name, 'Maneuvers', 'Maneuver not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="maneuversPath" :back-label="maneuversBackLabel">
    <ManeuverDetailArticle v-if="maneuver" :maneuver="maneuver" />

    <ReferenceNotFoundCard
      v-else
      title="Maneuver not found"
      :slug="slug"
      :back-to="maneuversPath"
      :back-label="maneuversNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
