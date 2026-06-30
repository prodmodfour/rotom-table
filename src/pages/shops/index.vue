<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import PlayerShopLibraryCard from '~/components/shops/PlayerShopLibraryCard.vue'
import ShopLibraryCard from '~/components/shops/ShopLibraryCard.vue'
import { useGmShopLibraryPage } from '~/composables/shops/useGmShopLibraryPage'
import { usePlayerShopLibraryPage } from '~/composables/shops/usePlayerShopLibraryPage'

const { isGm, isPlayer } = useAuth()
const isPlayerShopLibraryEnabled = computed(() => isPlayer.value)

const {
  shops,
  status: gmShopLibraryStatus,
  loadErrorMessage: gmShopLibraryErrorMessage,
  createErrorMessage,
  isCreatingShop,
  loadGmShops,
  createShop,
} = useGmShopLibraryPage({ isGm })

const {
  shops: playerShops,
  status: playerShopLibraryStatus,
  loadErrorMessage: playerShopLibraryErrorMessage,
  loadPlayerShops,
} = usePlayerShopLibraryPage({ isEnabled: isPlayerShopLibraryEnabled })

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

    <section v-if="isGm" class="shops-state" aria-label="GM shop library">
      <article class="shops-panel shops-panel--toolbar panel-card">
        <div>
          <p class="shops-eyebrow">GM shop library</p>
          <h2>Shop tables</h2>
          <p>Browse every campaign shop table, including closed and hidden setup documents.</p>
        </div>
        <button
          type="button"
          class="shops-action shops-action--primary"
          :disabled="isCreatingShop"
          @click="createShop"
        >
          {{ isCreatingShop ? 'Creating shop…' : '+ Create shop table' }}
        </button>
      </article>

      <p v-if="createErrorMessage" class="shops-inline-error panel-card" role="alert">
        {{ createErrorMessage }}
      </p>

      <article
        v-if="gmShopLibraryStatus === 'loading'"
        class="shops-panel panel-card"
        aria-busy="true"
        aria-live="polite"
      >
        <p class="shops-eyebrow">Loading</p>
        <h2>Loading shop tables…</h2>
        <p>Loading the authoritative campaign shop library.</p>
      </article>

      <article
        v-else-if="gmShopLibraryStatus === 'error'"
        class="shops-panel shops-panel--error panel-card"
        role="alert"
      >
        <p class="shops-eyebrow">Unavailable</p>
        <h2>Could not load shop tables</h2>
        <p>{{ gmShopLibraryErrorMessage ?? 'The GM shop library could not be loaded.' }}</p>
        <button type="button" class="shops-action" @click="loadGmShops">
          Retry loading shops
        </button>
      </article>

      <article v-else-if="gmShopLibraryStatus === 'empty'" class="shops-panel panel-card" role="status">
        <p class="shops-eyebrow">Empty</p>
        <h2>No shop tables yet</h2>
        <p>Click <strong>+ Create shop table</strong> to create a normalized shop document and open its GM editor.</p>
      </article>

      <section v-else class="shops-grid" aria-label="Shop tables">
        <ShopLibraryCard
          v-for="shop in shops"
          :key="shop.slug"
          :shop="shop"
        />
      </section>
    </section>

    <section v-else class="shops-state" aria-label="Open shop library">
      <article
        v-if="playerShopLibraryStatus === 'loading'"
        class="shops-panel panel-card"
        aria-busy="true"
        aria-live="polite"
      >
        <p class="shops-eyebrow">Loading</p>
        <h2>Loading open shops…</h2>
        <p>Loading open, player-visible shopfronts for this campaign.</p>
      </article>

      <article
        v-else-if="playerShopLibraryStatus === 'error'"
        class="shops-panel shops-panel--error panel-card"
        role="alert"
      >
        <p class="shops-eyebrow">Unavailable</p>
        <h2>Could not load shops</h2>
        <p>{{ playerShopLibraryErrorMessage ?? 'Open shops could not be loaded.' }}</p>
        <button type="button" class="shops-action" @click="loadPlayerShops">
          Retry loading shops
        </button>
      </article>

      <article v-else-if="playerShopLibraryStatus === 'empty'" class="shops-panel panel-card" role="status">
        <p class="shops-eyebrow">Empty</p>
        <h2>No shops are currently open</h2>
        <p>Open player-visible shopfronts will appear here when the GM opens them for players.</p>
      </article>

      <section v-else class="shops-grid" aria-label="Open shops">
        <PlayerShopLibraryCard
          v-for="shop in playerShops"
          :key="shop.slug"
          :shop="shop"
        />
      </section>
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

.shops-panel--toolbar {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.shops-hero p,
.shops-panel p,
.shops-inline-error {
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

.shops-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  gap: 1rem;
}

.shops-panel--error,
.shops-inline-error {
  border-color: color-mix(in srgb, var(--bad) 60%, var(--rule-soft));
}

.shops-inline-error {
  color: var(--bad);
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

.shops-action--primary {
  justify-self: end;
}

.shops-action:hover,
.shops-action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.shops-action:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 680px) {
  .shops-panel--toolbar {
    grid-template-columns: 1fr;
  }

  .shops-action--primary {
    justify-self: start;
  }
}
</style>
