<script setup lang="ts">
import type { ShopPurchaseAuditEntry, ShopPurchaseAuditLine } from '~/types/shop'

const props = defineProps<{
  entries: readonly ShopPurchaseAuditEntry[]
}>()

const currency = (value: number): string => `$${value.toLocaleString('en-US')}`

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

const actorLabel = (entry: ShopPurchaseAuditEntry): string => {
  if (entry.actor.role === 'gm') return 'GM checkout'
  const profileName = entry.actor.profileName?.trim()
  const profileId = entry.actor.profileId?.trim()
  if (profileName && profileId) return `Player ${profileName} (${profileId})`
  if (profileName) return `Player ${profileName}`
  if (profileId) return `Player ${profileId}`
  return 'Player checkout'
}

const participantKindLabel = (kind: ShopPurchaseAuditEntry['paymentSource']['kind']): string => (
  kind === 'trainer' ? 'Trainer' : 'Group inventory'
)

const participantLabel = (participant: ShopPurchaseAuditEntry['paymentSource']): string => (
  `${participantKindLabel(participant.kind)} ${participant.slug}`
)

const lineLabel = (line: ShopPurchaseAuditLine): string => (
  `${line.quantity.toLocaleString('en-US')} × ${line.itemName} (${currency(line.lineTotal)})`
)
</script>

<template>
  <section class="shop-purchase-audit" aria-labelledby="shop-purchase-audit-title">
    <div>
      <p class="shop-purchase-audit__eyebrow">Checkout audit</p>
      <h2 id="shop-purchase-audit-title">Recent purchases</h2>
      <p>
        The newest accepted checkout commands are retained on the shop document for GM troubleshooting. Replayed checkout operations do not create duplicate audit rows.
      </p>
    </div>

    <p
      v-if="props.entries.length === 0"
      class="shop-purchase-audit__empty"
      data-testid="shop-purchase-audit-empty"
    >
      No purchases have been recorded for this shop yet.
    </p>

    <ol v-else class="shop-purchase-audit__list" data-testid="shop-purchase-audit-list">
      <li
        v-for="entry in props.entries"
        :key="entry.opId"
        class="shop-purchase-audit__entry"
        data-testid="shop-purchase-audit-entry"
      >
        <div class="shop-purchase-audit__summary">
          <strong>{{ formatTimestamp(entry.purchasedAt) }}</strong>
          <span>{{ actorLabel(entry) }}</span>
          <span>{{ currency(entry.total) }} total</span>
        </div>
        <dl class="shop-purchase-audit__details">
          <div>
            <dt>Payment</dt>
            <dd>{{ participantLabel(entry.paymentSource) }}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{{ participantLabel(entry.deliveryTarget) }}</dd>
          </div>
          <div>
            <dt>Operation</dt>
            <dd>{{ entry.opId }}</dd>
          </div>
        </dl>
        <ul class="shop-purchase-audit__lines" aria-label="Purchased lines">
          <li v-for="line in entry.lines" :key="`${entry.opId}:${line.entryId}`">
            {{ lineLabel(line) }}
          </li>
        </ul>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.shop-purchase-audit {
  display: grid;
  gap: 0.7rem;
}

.shop-purchase-audit p {
  max-width: 72ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shop-purchase-audit__eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shop-purchase-audit h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.45rem, 3vw, 2.1rem);
  letter-spacing: 0.04em;
}

.shop-purchase-audit__empty,
.shop-purchase-audit__entry {
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  padding: 0.75rem;
}

.shop-purchase-audit__list {
  display: grid;
  gap: 0.65rem;
  margin: 0;
  padding-left: 1.25rem;
}

.shop-purchase-audit__entry {
  display: grid;
  gap: 0.55rem;
}

.shop-purchase-audit__summary,
.shop-purchase-audit__details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.8rem;
  align-items: center;
}

.shop-purchase-audit__summary strong,
.shop-purchase-audit__details dt {
  color: var(--ink-bright);
  font-weight: 900;
}

.shop-purchase-audit__summary span,
.shop-purchase-audit__details dd,
.shop-purchase-audit__lines {
  color: var(--ink-soft);
}

.shop-purchase-audit__details {
  margin: 0;
}

.shop-purchase-audit__details div {
  display: grid;
  gap: 0.12rem;
}

.shop-purchase-audit__details dt {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shop-purchase-audit__details dd {
  margin: 0;
}

.shop-purchase-audit__lines {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding-left: 1.25rem;
}
</style>
