<script setup lang="ts">
import { computed } from 'vue'
import type { ShopTableDocument } from '~/types/shop'
import { formatShopUpdatedAt, shopEntryCountLabel, shopUpdatedAtDateTime } from '~/utils/shopLibrary'
import { shopfrontPath } from '~/utils/shopRoutes'

const props = defineProps<{
  shop: ShopTableDocument
}>()

const shopfrontLocation = computed(() => shopfrontPath(props.shop.slug))
</script>

<template>
  <article class="player-shop-library-card panel-card" data-testid="player-shop-library-card">
    <header class="player-shop-library-card__header">
      <div>
        <p class="player-shop-library-card__eyebrow">Open shopfront</p>
        <h2>{{ shop.name }}</h2>
      </div>
      <span class="player-shop-library-card__badge">Open now</span>
    </header>

    <p v-if="shop.description" class="player-shop-library-card__description">
      {{ shop.description }}
    </p>

    <dl class="player-shop-library-card__meta">
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

    <NuxtLink class="player-shop-library-card__action" :to="shopfrontLocation">
      Browse shop
    </NuxtLink>
  </article>
</template>

<style scoped>
.player-shop-library-card {
  display: grid;
  gap: 0.85rem;
  align-content: start;
}

.player-shop-library-card__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.player-shop-library-card__eyebrow {
  margin: 0 0 0.25rem;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.player-shop-library-card h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.25rem, 2vw, 1.7rem);
  letter-spacing: 0.04em;
}

.player-shop-library-card__badge {
  border: 1px solid color-mix(in srgb, var(--good) 45%, var(--rule-soft));
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--good);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.28rem 0.55rem;
  text-transform: uppercase;
}

.player-shop-library-card__description {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.player-shop-library-card__meta {
  display: grid;
  gap: 0.45rem;
  margin: 0;
}

.player-shop-library-card__meta div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.player-shop-library-card__meta dt {
  color: var(--ink-soft);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.player-shop-library-card__meta dd {
  margin: 0;
  color: var(--ink);
}

.player-shop-library-card__action {
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

.player-shop-library-card__action:hover,
.player-shop-library-card__action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}
</style>
