<script setup lang="ts">
import { computed } from 'vue'
import { abilityBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const ability = computed(() => abilityBySlug.get(slug.value) ?? null)

useHead(() => ({
  title: referenceDetailTitle(ability.value?.name, 'Abilities', 'Ability not found'),
}))
</script>

<template>
  <ReferenceDetailShell back-to="/abilities" back-label="← All abilities">
    <AbilityDetailArticle v-if="ability" :ability="ability" />

    <ReferenceNotFoundCard
      v-else
      title="Ability not found"
      :slug="slug"
      back-to="/abilities"
      back-label="← Back to all abilities"
    />
  </ReferenceDetailShell>
</template>
