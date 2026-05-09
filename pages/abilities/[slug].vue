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
        <div class="detail-heading">
          <h1>{{ ability.name }}</h1>
          <div class="detail-pills">
            <span v-if="ability.frequency" class="badge">{{ ability.frequency }}</span>
          </div>
        </div>

        <section v-if="ability.trigger" class="field-block">
          <h3>Trigger</h3>
          <p>{{ ability.trigger }}</p>
        </section>

        <section v-if="ability.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ ability.effect }}</p>
        </section>
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
