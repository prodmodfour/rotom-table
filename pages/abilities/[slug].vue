<script setup lang="ts">
import { computed } from 'vue'
import { abilityBySlug } from '~/data/ptuReference'
import { referenceDetailTitle } from '~/utils/reference/pageTitles'

const route = useRoute()

const ability = computed(() => abilityBySlug.get(String(route.params.slug ?? '')) ?? null)

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
        :slug="route.params.slug"
        back-to="/abilities"
        back-label="← Back to all abilities"
      />
  </ReferenceDetailShell>
</template>
