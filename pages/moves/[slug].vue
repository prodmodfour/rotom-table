<script setup lang="ts">
import { computed } from 'vue'
import { moveBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()

const move = computed(() => moveBySlug.get(routeSlugParam(route.params)) ?? null)

useHead(() => ({
  title: referenceDetailTitle(move.value?.name, 'Moves', 'Move not found'),
}))
</script>

<template>
  <ReferenceDetailShell back-to="/moves" back-label="← All moves">
      <MoveDetailArticle v-if="move" :move="move" />

      <ReferenceNotFoundCard
        v-else
        title="Move not found"
        :slug="route.params.slug"
        back-to="/moves"
        back-label="← Back to all moves"
      />
  </ReferenceDetailShell>
</template>
