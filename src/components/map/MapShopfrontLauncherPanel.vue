<script setup lang="ts">
import { computed } from 'vue'
import type {
  MapShopfrontLauncherEntry,
  MapShopfrontLauncherStatus,
} from '~/composables/map-editor/useMapShopfrontLauncher'

const props = withDefaults(defineProps<{
  entries: readonly MapShopfrontLauncherEntry[]
  status?: MapShopfrontLauncherStatus
  errorMessage?: string | null
}>(), {
  status: 'idle',
  errorMessage: null,
})

const emit = defineEmits<{
  (event: 'reload'): void
}>()

const panelVisible = computed(() => props.status !== 'idle')
const hasEntries = computed(() => props.entries.length > 0)

const entryStateLabel = (entry: MapShopfrontLauncherEntry): string => {
  const shopState = entry.shop.open ? 'Open' : 'Closed'
  const visibility = entry.shop.playerVisible ? 'Player-visible' : 'Hidden'
  return `${shopState} · ${visibility}`
}

const positionLabel = (entry: MapShopfrontLauncherEntry): string | null => {
  const position = entry.shopInterface.position
  if (!position) return null
  return `Position ${position.x}, ${position.y}, ${position.z}`
}

const rangeLabel = (entry: MapShopfrontLauncherEntry): string | null => {
  const range = entry.shopInterface.interactionRangeMeters
  return range === undefined ? null : `Range ${range}m`
}
</script>

<template>
  <aside
    v-if="panelVisible"
    class="map-shopfront-launcher panel-card"
    aria-labelledby="map-shopfront-launcher-heading"
  >
    <div class="map-shopfront-launcher__header">
      <div>
        <p class="map-shopfront-launcher__eyebrow">Map shops</p>
        <h2 id="map-shopfront-launcher-heading">Shopfronts</h2>
      </div>
      <button
        type="button"
        class="map-shopfront-launcher__reload"
        :disabled="status === 'loading'"
        @click="emit('reload')"
      >
        {{ status === 'loading' ? 'Loading…' : 'Reload' }}
      </button>
    </div>

    <p v-if="status === 'loading'" class="map-shopfront-launcher__message" aria-live="polite">
      Loading mapped shopfronts…
    </p>

    <div v-else-if="status === 'error'" class="map-shopfront-launcher__message map-shopfront-launcher__message--error" role="alert">
      <p>{{ errorMessage ?? 'Mapped shopfronts could not be loaded.' }}</p>
    </div>

    <p v-else-if="!hasEntries" class="map-shopfront-launcher__message">
      No open mapped shops are available from this map right now.
    </p>

    <ol v-else class="map-shopfront-launcher__list" aria-label="Mapped shopfronts">
      <li v-for="entry in entries" :key="entry.shopInterface.id" class="map-shopfront-launcher__item">
        <div class="map-shopfront-launcher__item-main">
          <div>
            <strong>{{ entry.shopInterface.label }}</strong>
            <span>{{ entry.shop.name || entry.shop.slug }}</span>
          </div>
          <NuxtLink
            class="map-shopfront-launcher__open"
            data-testid="map-shopfront-open"
            :to="entry.to"
          >
            Open
          </NuxtLink>
        </div>
        <div class="map-shopfront-launcher__meta" aria-label="Shopfront details">
          <span>{{ entryStateLabel(entry) }}</span>
          <span v-if="positionLabel(entry)">{{ positionLabel(entry) }}</span>
          <span v-if="rangeLabel(entry)">{{ rangeLabel(entry) }}</span>
          <span v-if="entry.origin.actorPlacementId">Actor {{ entry.origin.actorPlacementId }}</span>
        </div>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.map-shopfront-launcher {
  position: absolute;
  z-index: 5;
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  display: grid;
  gap: 0.75rem;
  width: min(25rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.85rem;
  color: var(--ink);
}

.map-shopfront-launcher__header,
.map-shopfront-launcher__item-main,
.map-shopfront-launcher__meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
}

.map-shopfront-launcher__eyebrow,
.map-shopfront-launcher h2,
.map-shopfront-launcher p {
  margin: 0;
}

.map-shopfront-launcher__eyebrow {
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.map-shopfront-launcher h2 {
  margin-top: 0.15rem;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.35rem;
  letter-spacing: 0.04em;
}

.map-shopfront-launcher__reload,
.map-shopfront-launcher__open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.42rem 0.68rem;
  text-decoration: none;
  text-transform: uppercase;
}

.map-shopfront-launcher__reload:hover:not(:disabled),
.map-shopfront-launcher__reload:focus-visible:not(:disabled),
.map-shopfront-launcher__open:hover,
.map-shopfront-launcher__open:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.map-shopfront-launcher__reload:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.map-shopfront-launcher__message {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-size: 0.84rem;
  line-height: 1.45;
  padding: 0.6rem 0.7rem;
}

.map-shopfront-launcher__message--error {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.map-shopfront-launcher__list {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.map-shopfront-launcher__item {
  display: grid;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
  padding: 0.65rem;
}

.map-shopfront-launcher__item-main strong,
.map-shopfront-launcher__item-main span {
  display: block;
}

.map-shopfront-launcher__item-main strong {
  color: var(--ink-bright);
  font-size: 0.95rem;
}

.map-shopfront-launcher__item-main span,
.map-shopfront-launcher__meta {
  color: var(--ink-soft);
  font-size: 0.78rem;
}

.map-shopfront-launcher__meta {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.map-shopfront-launcher__meta span {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  padding: 0.18rem 0.45rem;
}

@media (max-width: 760px) {
  .map-shopfront-launcher {
    right: var(--map-overlay-gutter, 0.75rem);
    bottom: var(--map-overlay-gutter, 0.75rem);
    left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px));
    width: auto;
  }
}
</style>
