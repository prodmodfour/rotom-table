<script setup lang="ts">
import { computed } from 'vue'
import { abilityBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'
import { referenceAllBackLabel, referenceIndexPath, referenceNotFoundBackLabel } from '~/utils/reference/routes'
import { routeSlugParam } from '~/utils/routeParams'

const route = useRoute()
const slug = computed(() => routeSlugParam(route.params))

const ability = computed(() => abilityBySlug.get(slug.value) ?? null)
const abilitiesPath = referenceIndexPath('ability')
const abilitiesBackLabel = referenceAllBackLabel('ability')
const abilitiesNotFoundBackLabel = referenceNotFoundBackLabel('ability')

useHead(() => ({
  title: referenceDetailTitle(ability.value?.name, 'Abilities', 'Ability not found'),
}))
</script>

<template>
  <ReferenceDetailShell :back-to="abilitiesPath" :back-label="abilitiesBackLabel">
    <AbilityDetailArticle v-if="ability" :ability="ability" />

    <ReferenceNotFoundCard
      v-else
      title="Ability not found"
      :slug="slug"
      :back-to="abilitiesPath"
      :back-label="abilitiesNotFoundBackLabel"
    />
  </ReferenceDetailShell>
</template>
