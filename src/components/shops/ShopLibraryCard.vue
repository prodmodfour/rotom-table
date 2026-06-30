<script setup lang="ts">
import { computed } from 'vue'
import type { ShopTableDocument } from '~/types/shop'
import { formatShopUpdatedAt, shopEntryCountLabel, shopUpdatedAtDateTime } from '~/utils/shopLibrary'
import { shopEditorPath } from '~/utils/shopRoutes'

const props = defineProps<{
  shop: ShopTableDocument
}>()

const editorPath = computed(() => shopEditorPath(props.shop.slug))
</script>

<template>
  <article class="shop-library-card panel-card" data-testid="shop-library-card">
    <header class="shop-library-card__header">
      <div>
        <p class="shop-library-card__eyebrow">Shop table</p>
        <h2>{{ shop.name }}</h2>
      </div>
      <div class="shop-library-card__badges" aria-label="Shop status">
        <span
          class="shop-library-card__badge"
          :class="shop.open ? 'shop-library-card__badge--open' : 'shop-library-card__badge--closed'"
        >
          {{ shop.open ? 'Open' : 'Closed' }}
        </span>
        <span
          class="shop-library-card__badge"
          :class="shop.playerVisible ? 'shop-library-card__badge--visible' : 'shop-library-card__badge--hidden'"
        >
          {{ shop.playerVisible ? 'Player visible' : 'Hidden' }}
        </span>
      </div>
    </header>

    <dl class="shop-library-card__meta">
      <div>
        <dt>Slug</dt>
        <dd><code>{{ shop.slug }}</code></dd>
      </div>
      <div>
        <dt>Entries</dt>
        <dd>{{ shopEntryCountLabel(shop) }}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>
          <time :datetime="shopUpdatedAtDateTime(shop.updatedAt)">
            {{ formatShopUpdatedAt(shop.updatedAt) }}
          </time>
        </dd>
      </div>
    </dl>

    <NuxtLink class="shop-library-card__action" :to="editorPath">
      Edit shop
    </NuxtLink>
  </article>
</template>

<style scoped>
.shop-library-card {
  display: grid;
  gap: 0.85rem;
  align-content: start;
}

.shop-library-card__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.shop-library-card__eyebrow {
  margin: 0 0 0.25rem;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shop-library-card h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.25rem, 2vw, 1.7rem);
  letter-spacing: 0.04em;
}

.shop-library-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.shop-library-card__badge {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.28rem 0.55rem;
  text-transform: uppercase;
}

.shop-library-card__badge--open,
.shop-library-card__badge--visible {
  border-color: color-mix(in srgb, var(--good) 45%, var(--rule-soft));
  color: var(--good);
}

.shop-library-card__badge--closed,
.shop-library-card__badge--hidden {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--rule-soft));
  color: var(--warn);
}

.shop-library-card__meta {
  display: grid;
  gap: 0.45rem;
  margin: 0;
}

.shop-library-card__meta div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.shop-library-card__meta dt {
  color: var(--ink-soft);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shop-library-card__meta dd {
  margin: 0;
  color: var(--ink);
}

.shop-library-card__meta code {
  font-family: var(--font-mono);
}

.shop-library-card__action {
  justify-self: start;
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

.shop-library-card__action:hover,
.shop-library-card__action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}
</style>
