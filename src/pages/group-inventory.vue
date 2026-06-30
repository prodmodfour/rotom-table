<script setup lang="ts">
import { ref } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'

type GroupInventoryShellState = 'loading' | 'error' | 'empty'

const inventoryShellState = ref<GroupInventoryShellState>('empty')
const inventoryShellError = ref<string | null>(null)

useHead({
  title: 'Inventory · Rotom Table',
  meta: [
    {
      name: 'description',
      content: 'Shared party inventory workspace for Rotom Table live-play campaigns.',
    },
  ],
})
</script>

<template>
  <main class="group-inventory-page">
    <AppNavigation />

    <header class="group-inventory-hero panel-card">
      <div>
        <p class="group-inventory-eyebrow">Party inventory</p>
        <h1>Inventory</h1>
        <p>
          A shared campaign inventory will live here for the table. This shell is available to both GMs and players before persistence is wired into the page.
        </p>
      </div>
    </header>

    <section class="group-inventory-state" aria-label="Shared inventory status">
      <article
        v-if="inventoryShellState === 'loading'"
        class="group-inventory-panel panel-card"
        aria-busy="true"
        aria-live="polite"
      >
        <p class="group-inventory-eyebrow">Loading</p>
        <h2>Loading shared inventory…</h2>
        <p>Checking the campaign inventory state. The live load hook will replace this placeholder in a later ticket.</p>
      </article>

      <article
        v-else-if="inventoryShellState === 'error'"
        class="group-inventory-panel group-inventory-panel--error panel-card"
        role="alert"
      >
        <p class="group-inventory-eyebrow">Unavailable</p>
        <h2>Could not open shared inventory</h2>
        <p>{{ inventoryShellError || 'The shared inventory panel is not connected to campaign storage yet.' }}</p>
      </article>

      <article v-else class="group-inventory-panel panel-card">
        <p class="group-inventory-eyebrow">Ready for wiring</p>
        <h2>Shared inventory panel</h2>
        <p>
          The campaign inventory page is in place. Upcoming tickets will load the authoritative group inventory document, render item sections, and add table-safe transfer flows.
        </p>
        <div class="group-inventory-placeholder" aria-label="Empty inventory placeholder">
          <span aria-hidden="true">▣</span>
          <div>
            <strong>No inventory rows loaded yet.</strong>
            <p>Persistence and item tables are intentionally deferred from this static page shell.</p>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.group-inventory-page {
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

.group-inventory-hero,
.group-inventory-panel {
  display: grid;
  gap: 0.7rem;
}

.group-inventory-hero p,
.group-inventory-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.group-inventory-hero .group-inventory-eyebrow,
.group-inventory-panel .group-inventory-eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-inventory-hero h1,
.group-inventory-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.group-inventory-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.group-inventory-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.group-inventory-state {
  display: grid;
  gap: 1rem;
}

.group-inventory-panel--error {
  border-color: color-mix(in srgb, var(--bad) 60%, var(--rule-soft));
}

.group-inventory-placeholder {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: min(100%, 42rem);
  padding: 0.9rem 1rem;
  border: 1px dashed var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink-muted);
}

.group-inventory-placeholder > span {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--rule-soft);
  color: var(--accent);
  font-size: 1.25rem;
}

.group-inventory-placeholder strong {
  color: var(--ink-bright);
}

.group-inventory-placeholder p {
  margin-top: 0.15rem;
}
</style>
