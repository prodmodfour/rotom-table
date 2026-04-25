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
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/abilities" class="back-link">← All abilities</NuxtLink>
      </div>
    </header>

    <main>
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

      <article v-else class="panel-card">
        <h1>Ability not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/abilities" class="back-link">← Back to all abilities</NuxtLink>
      </article>
    </main>
  </div>
</template>
