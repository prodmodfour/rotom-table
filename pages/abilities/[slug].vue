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
      <article v-if="ability" class="panel-card">
        <ReferenceDetailHeading :title="ability.name">
          <template #pills>
            <span v-if="ability.frequency" class="badge">{{ ability.frequency }}</span>
          </template>
        </ReferenceDetailHeading>

        <ReferenceFieldBlock v-if="ability.trigger" title="Trigger">
          <p>{{ ability.trigger }}</p>
        </ReferenceFieldBlock>

        <ReferenceFieldBlock v-if="ability.effect" title="Effect">
          <p>{{ ability.effect }}</p>
        </ReferenceFieldBlock>
      </article>

      <ReferenceNotFoundCard
        v-else
        title="Ability not found"
        :slug="route.params.slug"
        back-to="/abilities"
        back-label="← Back to all abilities"
      />
  </ReferenceDetailShell>
</template>
