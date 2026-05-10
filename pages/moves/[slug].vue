<script setup lang="ts">
import { computed } from 'vue'
import { moveBySlug } from '~/data/ptuReference'

const route = useRoute()

const move = computed(() => moveBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: move.value
    ? `${move.value.name} · Moves`
    : 'Move not found · Rotom Table',
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
