<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { routeSlugParam } from '~/utils/routeParams'
import { shopfrontPath, shopLibraryPath } from '~/utils/shopRoutes'

definePageMeta({
  middleware: (to) => {
    const { isPlayer } = useAuth()
    if (!isPlayer.value) return

    const slug = routeSlugParam(to.params)
    return navigateTo(slug ? shopfrontPath(slug) : shopLibraryPath(), { replace: true })
  },
})

const route = useRoute()
const { isGm } = useAuth()

const shopSlug = computed(() => routeSlugParam(route.params))
const shopfrontLocation = computed(() => (
  shopSlug.value ? shopfrontPath(shopSlug.value) : shopLibraryPath()
))

useHead(() => ({
  title: shopSlug.value ? `Edit ${shopSlug.value} shop · Rotom Table` : 'Edit shop · Rotom Table',
  meta: [
    {
      name: 'description',
      content: 'GM shop editor shell for Rotom Table live-play campaigns.',
    },
  ],
}))
</script>

<template>
  <main class="shop-edit-page">
    <AppNavigation />

    <header class="shop-edit-hero panel-card">
      <div>
        <p class="shop-edit-eyebrow">GM shop editor shell</p>
        <h1>Edit {{ shopSlug || 'shop' }}</h1>
        <p>
          This route is reserved for GM setup and maintenance of shop table documents. Saving, deleting, and entry editing will be wired by later shop tickets.
        </p>
      </div>
      <div class="shop-edit-actions" aria-label="Shop editor navigation">
        <NuxtLink class="shop-edit-action" :to="shopfrontLocation">
          Preview shopfront shell
        </NuxtLink>
        <NuxtLink class="shop-edit-action" :to="shopLibraryPath()">
          Back to shops
        </NuxtLink>
      </div>
    </header>

    <section v-if="!isGm" class="shop-edit-panel shop-edit-panel--warning panel-card" role="status">
      <p class="shop-edit-eyebrow">GM access required</p>
      <h2>Shop editing is unavailable</h2>
      <p>Only GM users can access the shop editor route.</p>
    </section>

    <section v-else class="shop-edit-panel panel-card" role="status">
      <p class="shop-edit-eyebrow">Pending editor data</p>
      <h2>No editable shop document is loaded yet</h2>
      <p>
        The editor shell does not mutate shop data. Revision-checked save and delete controls will be added when the full GM editor ticket is implemented.
      </p>
    </section>
  </main>
</template>

<style scoped>
.shop-edit-page {
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

.shop-edit-hero,
.shop-edit-panel {
  display: grid;
  gap: 0.7rem;
}

.shop-edit-hero p,
.shop-edit-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shop-edit-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shop-edit-hero h1,
.shop-edit-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shop-edit-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.shop-edit-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shop-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.shop-edit-action {
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

.shop-edit-action:hover,
.shop-edit-action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.shop-edit-panel--warning {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--rule-soft));
}
</style>
