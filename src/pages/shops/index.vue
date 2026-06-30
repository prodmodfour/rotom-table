<script setup lang="ts">
import { computed, ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'

type ShopLibraryShellStatus = 'loading' | 'empty' | 'error'

const { isGm } = useAuth()

const shopLibraryStatus = ref<ShopLibraryShellStatus>('empty')
const shopLibraryErrorMessage = ref<string | null>(null)

const emptyHeading = computed(() => (
  isGm.value ? 'No shop tables are displayed yet' : 'No shops are currently displayed'
))
const emptyDescription = computed(() => (
  isGm.value
    ? 'The GM shop library route is ready. Shop cards and creation controls will be wired in the next shop tickets.'
    : 'The player shop browser route is ready. Open, player-visible shopfronts will appear here once the browser is wired.'
))

const resetShopLibraryShell = () => {
  shopLibraryErrorMessage.value = null
  shopLibraryStatus.value = 'empty'
}

useHead({
  title: 'Shops · Rotom Table',
  meta: [
    {
      name: 'description',
      content: 'Shop table library shell for Rotom Table live-play campaigns.',
    },
  ],
})
</script>

<template>
  <main class="shops-page">
    <AppNavigation />

    <header class="shops-hero panel-card">
      <div>
        <p class="shops-eyebrow">Campaign shops</p>
        <h1>Shops</h1>
        <p>
          Shop tables are campaign-level SQLite documents. GMs manage reusable shops here, while players browse open player-visible shopfronts.
        </p>
      </div>
    </header>

    <section class="shops-state" aria-label="Shop library status">
      <article
        v-if="shopLibraryStatus === 'loading'"
        class="shops-panel panel-card"
        aria-busy="true"
        aria-live="polite"
      >
        <p class="shops-eyebrow">Loading</p>
        <h2>Loading shops…</h2>
        <p>Preparing the shop library shell.</p>
      </article>

      <article
        v-else-if="shopLibraryStatus === 'error'"
        class="shops-panel shops-panel--error panel-card"
        role="alert"
      >
        <p class="shops-eyebrow">Unavailable</p>
        <h2>Could not open shops</h2>
        <p>{{ shopLibraryErrorMessage ?? 'The shop library shell could not be prepared.' }}</p>
        <button type="button" class="shops-action" @click="resetShopLibraryShell">
          Return to shop shell
        </button>
      </article>

      <article v-else class="shops-panel panel-card" role="status">
        <p class="shops-eyebrow">Empty</p>
        <h2>{{ emptyHeading }}</h2>
        <p>{{ emptyDescription }}</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.shops-page {
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

.shops-hero,
.shops-panel {
  display: grid;
  gap: 0.7rem;
}

.shops-hero p,
.shops-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shops-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shops-hero h1,
.shops-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shops-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.shops-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shops-state {
  display: grid;
  gap: 1rem;
}

.shops-panel--error {
  border-color: color-mix(in srgb, var(--bad) 60%, var(--rule-soft));
}

.shops-action {
  justify-self: start;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-transform: uppercase;
}

.shops-action:hover,
.shops-action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}
</style>
