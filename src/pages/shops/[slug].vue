<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { routeSlugParam } from '~/utils/routeParams'
import { shopEditorPath, shopLibraryPath } from '~/utils/shopRoutes'

const route = useRoute()
const { isGm } = useAuth()

const shopSlug = computed(() => routeSlugParam(route.params))
const shopEditorLocation = computed(() => (
  shopSlug.value ? shopEditorPath(shopSlug.value) : shopLibraryPath()
))

useHead(() => ({
  title: shopSlug.value ? `${shopSlug.value} shop · Rotom Table` : 'Shop · Rotom Table',
  meta: [
    {
      name: 'description',
      content: 'Player-facing shopfront shell for Rotom Table live-play campaigns.',
    },
  ],
}))
</script>

<template>
  <main class="shopfront-page">
    <AppNavigation />

    <header class="shopfront-hero panel-card">
      <div>
        <p class="shopfront-eyebrow">Shopfront shell</p>
        <h1>{{ shopSlug || 'Shop' }}</h1>
        <p>
          This route is reserved for the player-facing shopfront. Item browsing and checkout controls will be added through later live-play shop tickets.
        </p>
      </div>
      <div class="shopfront-actions" aria-label="Shopfront navigation">
        <NuxtLink class="shopfront-action" :to="shopLibraryPath()">
          Back to shops
        </NuxtLink>
        <NuxtLink v-if="isGm" class="shopfront-action" :to="shopEditorLocation">
          Open GM editor shell
        </NuxtLink>
      </div>
    </header>

    <section class="shopfront-panel panel-card" role="status">
      <p class="shopfront-eyebrow">Pending shop data</p>
      <h2>No shop document is rendered yet</h2>
      <p>
        The shell keeps the route available without rendering catalog, price, stock, or checkout state until the dedicated shopfront ticket wires the read-only view.
      </p>
    </section>
  </main>
</template>

<style scoped>
.shopfront-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: 1rem;
  padding: 1rem;
  background:
    radial-gradient(circle at top left, rgba(var(--accent-rgb), 0.14), transparent 30rem),
    var(--paper);
  color: var(--ink);
}

.shopfront-hero,
.shopfront-panel {
  display: grid;
  gap: 0.7rem;
}

.shopfront-hero p,
.shopfront-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shopfront-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shopfront-hero h1,
.shopfront-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shopfront-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.shopfront-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shopfront-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.shopfront-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-decoration: none;
  text-transform: uppercase;
}

.shopfront-action:hover,
.shopfront-action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}
</style>
