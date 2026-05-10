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
      <article v-if="cap" class="panel-card capability-detail-card">
        <CapabilityArt :name="cap.name" size="hero" class="capability-detail-card__art" />

        <div class="capability-detail-card__copy">
          <div class="detail-heading">
            <h1>{{ cap.name }}</h1>
          </div>

          <section v-if="cap.effect" class="field-block">
            <h3>Effect</h3>
            <p>{{ cap.effect }}</p>
          </section>
        </div>
      </article>

      <article v-else class="panel-card">
        <h1>Capability not found</h1>
        <p>No entry for slug <code>{{ route.params.slug }}</code>.</p>
        <NuxtLink to="/capabilities" class="back-link">← Back to all capabilities</NuxtLink>
      </article>
    </main>
  </div>
</template>

<style scoped>
.capability-detail-card {
  display: grid;
  grid-template-columns: minmax(168px, 230px) minmax(0, 1fr);
  gap: 1.15rem;
  align-items: start;
}

.capability-detail-card__art {
  justify-self: center;
}

.capability-detail-card__copy {
  min-width: 0;
}

@media (max-width: 720px) {
  .capability-detail-card {
    grid-template-columns: 1fr;
  }
}
</style>
