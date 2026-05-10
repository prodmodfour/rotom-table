<script setup lang="ts">
import { computed } from 'vue'
import { abilityBySlug } from '~/data/ptuReference'

const route = useRoute()

const ability = computed(() => abilityBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: ability.value
    ? `${ability.value.name} · Abilities`
    : 'Ability not found · Rotom Table',
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
