<script setup lang="ts">
import type { ShopEntry, ShopTableDocument, ShopStockValue } from '~/types/shop'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'

const props = defineProps<{
  shop: ShopTableDocument
}>()

const sectionTitleByKey = new Map(
  TRAINER_INVENTORY_SECTIONS.map((section) => [section.key, section.title] as const),
)

const safeInteger = (value: unknown): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
)

const entryName = (entry: ShopEntry): string => entry.itemName.trim() || 'Unnamed item'

const sectionTitle = (entry: ShopEntry): string => sectionTitleByKey.get(entry.section) ?? 'Items'

const priceLabel = (entry: ShopEntry): string => `$${safeInteger(entry.price).toLocaleString('en-US')}`

const stockLabel = (stock: ShopStockValue): string => (
  stock === null ? 'Unlimited' : `${safeInteger(stock).toLocaleString('en-US')} in stock`
)

const maxPerPurchaseLabel = (entry: ShopEntry): string => (
  entry.maxPerPurchase && entry.maxPerPurchase > 0
    ? `${safeInteger(entry.maxPerPurchase).toLocaleString('en-US')} per purchase`
    : 'No limit'
)
</script>

<template>
  <section class="shopfront-catalog panel-card" data-testid="shopfront-catalog" aria-labelledby="shopfront-catalog-title">
    <header class="shopfront-catalog__header">
      <div>
        <p class="shopfront-catalog__eyebrow">Read-only catalog</p>
        <h2 id="shopfront-catalog-title">Items for sale</h2>
        <p>
          Browse the current catalog before checkout commands are available. Buy controls are intentionally disabled for now.
        </p>
      </div>
      <span class="shopfront-catalog__count">
        {{ shop.entries.length }} {{ shop.entries.length === 1 ? 'entry' : 'entries' }}
      </span>
    </header>

    <p v-if="shop.entries.length === 0" class="shopfront-catalog__empty" role="status">
      This shop does not list any items yet.
    </p>

    <ul v-else class="shopfront-catalog__grid" aria-label="Shop item entries">
      <li
        v-for="entry in props.shop.entries"
        :key="entry.id"
        class="shopfront-entry-card"
        data-testid="shopfront-entry-card"
      >
        <header class="shopfront-entry-card__header">
          <p class="shopfront-entry-card__section">{{ sectionTitle(entry) }}</p>
          <h3>{{ entryName(entry) }}</h3>
        </header>

        <p v-if="entry.playerDescription" class="shopfront-entry-card__description">
          {{ entry.playerDescription }}
        </p>

        <dl class="shopfront-entry-card__meta">
          <div>
            <dt>Price</dt>
            <dd data-testid="shopfront-entry-price">{{ priceLabel(entry) }}</dd>
          </div>
          <div>
            <dt>Stock</dt>
            <dd data-testid="shopfront-entry-stock">{{ stockLabel(entry.stock) }}</dd>
          </div>
          <div>
            <dt>Max per purchase</dt>
            <dd data-testid="shopfront-entry-max">{{ maxPerPurchaseLabel(entry) }}</dd>
          </div>
        </dl>

        <button type="button" class="shopfront-entry-card__buy" disabled>
          Buy coming soon
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.shopfront-catalog {
  display: grid;
  gap: 1rem;
}

.shopfront-catalog__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.shopfront-catalog__header p,
.shopfront-catalog__empty,
.shopfront-entry-card__description {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.shopfront-catalog__eyebrow,
.shopfront-entry-card__section {
  margin: 0;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shopfront-catalog h2,
.shopfront-entry-card h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shopfront-catalog h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shopfront-entry-card h3 {
  font-size: clamp(1.25rem, 2vw, 1.65rem);
}

.shopfront-catalog__count {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.32rem 0.6rem;
  text-transform: uppercase;
}

.shopfront-catalog__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.shopfront-entry-card {
  display: grid;
  gap: 0.75rem;
  align-content: start;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  padding: 0.9rem;
}

.shopfront-entry-card__header {
  display: grid;
  gap: 0.2rem;
}

.shopfront-entry-card__meta {
  display: grid;
  gap: 0.45rem;
  margin: 0;
}

.shopfront-entry-card__meta div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.shopfront-entry-card__meta dt {
  color: var(--ink-soft);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shopfront-entry-card__meta dd {
  margin: 0;
  color: var(--ink);
}

.shopfront-entry-card__buy {
  justify-self: start;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: not-allowed;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-transform: uppercase;
  opacity: 0.72;
}
</style>
