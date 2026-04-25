<script setup lang="ts">
import { computed } from 'vue'
import { capabilityBySlug } from '~/data/ptuReference'

const route = useRoute()

const cap = computed(() => capabilityBySlug.get(String(route.params.slug ?? '')) ?? null)

useHead(() => ({
  title: cap.value
    ? `${cap.value.name} · Capabilities`
    : 'Capability not found · Rotom Table',
}))
</script>

<template>
  <div class="ref-detail">
    <header class="ref-header">
      <AppNavigation />
      <div class="back-row">
        <NuxtLink to="/capabilities" class="back-link">← All capabilities</NuxtLink>
      </div>
    </header>

    <main>
      <article v-if="cap" class="panel-card">
        <div class="detail-heading">
          <h1>{{ cap.name }}</h1>
          <div class="detail-pills">
            <span v-if="cap.source" class="badge">{{ cap.source }}</span>
          </div>
        </div>

        <section v-if="cap.effect" class="field-block">
          <h3>Effect</h3>
          <p>{{ cap.effect }}</p>
        </section>
      </article>

      <article v-else class="panel-card">
        <h1>Capability not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/capabilities" class="back-link">← Back to all capabilities</NuxtLink>
      </article>
    </main>
  </div>
</template>
