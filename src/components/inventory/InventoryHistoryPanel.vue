<script setup lang="ts">
import { computed, useId } from 'vue'
import {
  PhArrowCounterClockwise,
  PhArrowsLeftRight,
  PhCheckCircle,
  PhFirstAidKit,
  PhGift,
  PhGavel,
  PhPackage,
  PhShoppingBag,
  PhTrash,
  PhWrench,
} from '@phosphor-icons/vue'
import {
  INVENTORY_HISTORY_KIND_LABELS,
  type InventoryHistoryFactKind,
  type InventoryHistoryProjectionV1,
} from '#shared/itemAutomation/inventoryHistory'
import type { InventoryHistoryLoadStatus } from '~/composables/inventory/useInventoryHistory'

const props = withDefaults(defineProps<{
  projection?: InventoryHistoryProjectionV1 | null
  status?: InventoryHistoryLoadStatus
  error?: string | null
}>(), {
  projection: null,
  status: 'idle',
  error: null,
})

const emit = defineEmits<{ refresh: [] }>()
const titleId = `inventory-history-${useId()}`
const facts = computed(() => props.projection?.facts ?? [])
const busy = computed(() => props.status === 'loading')
const iconFor = (kind: InventoryHistoryFactKind) => ({
  purchase: PhShoppingBag,
  transfer: PhArrowsLeftRight,
  'item-use': PhFirstAidKit,
  'equipment-change': PhWrench,
  'guided-outcome': PhGavel,
  'settlement-award': PhGift,
  discard: PhTrash,
  'gm-correction': PhArrowCounterClockwise,
}[kind] ?? PhPackage)
const dateTime = (occurredAt: number): string => new Date(occurredAt).toISOString()
const timeLabel = (occurredAt: number): string => new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
}).format(new Date(occurredAt))
const footerCopy = computed(() => {
  const count = facts.value.length
  if (count === 0) return null
  if (props.projection?.truncated) return `Showing the ${count} most recent accepted receipts.`
  return `Showing ${count} accepted receipt${count === 1 ? '' : 's'}.`
})
</script>

<template>
  <section
    class="inventory-history"
    :aria-labelledby="titleId"
    :aria-busy="busy"
  >
    <header class="inventory-history__header">
      <div>
        <p class="inventory-history__eyebrow">Recent accepted changes</p>
        <h3 :id="titleId">Inventory activity</h3>
        <p class="inventory-history__intro">Only player-readable results appear here.</p>
      </div>
      <button
        type="button"
        class="inventory-history__refresh"
        :disabled="busy"
        @click="emit('refresh')"
      >
        <PhArrowCounterClockwise :size="18" weight="bold" aria-hidden="true" />
        {{ busy ? 'Refreshing history…' : 'Refresh history' }}
      </button>
    </header>

    <p v-if="status === 'error'" class="inventory-history__error" role="alert">
      {{ error ?? 'Inventory activity could not be loaded.' }}
    </p>
    <p v-else-if="busy && facts.length" class="inventory-history__refreshing" role="status" aria-live="polite">
      Checking for newer accepted receipts…
    </p>

    <div v-if="busy && !facts.length" class="inventory-history__state" role="status" aria-live="polite">
      <PhArrowCounterClockwise :size="24" weight="bold" aria-hidden="true" />
      <p>Loading accepted inventory receipts…</p>
    </div>
    <div v-else-if="status === 'error' && !facts.length" class="inventory-history__state">
      <PhPackage :size="24" weight="bold" aria-hidden="true" />
      <p>Retry to load player-readable inventory activity.</p>
    </div>
    <div v-else-if="!facts.length" class="inventory-history__state" role="status">
      <PhCheckCircle :size="24" weight="bold" aria-hidden="true" />
      <p>No accepted inventory receipts yet.</p>
    </div>

    <ol v-else class="inventory-history__list" aria-label="Accepted inventory receipts">
      <li
        v-for="(fact, index) in facts"
        :key="`${fact.occurredAt}:${fact.kind}:${index}`"
        class="inventory-history__fact"
        :class="`inventory-history__fact--${fact.kind}`"
      >
        <span class="inventory-history__icon" aria-hidden="true">
          <component :is="iconFor(fact.kind)" :size="22" weight="bold" />
        </span>
        <article>
          <header class="inventory-history__fact-header">
            <p>{{ INVENTORY_HISTORY_KIND_LABELS[fact.kind] }}</p>
            <time :datetime="dateTime(fact.occurredAt)">{{ timeLabel(fact.occurredAt) }}</time>
          </header>
          <h4>{{ fact.headline }}</h4>
          <ul v-if="fact.details.length" class="inventory-history__details">
            <li v-for="detail in fact.details" :key="detail">{{ detail }}</li>
          </ul>
        </article>
      </li>
    </ol>

    <footer v-if="footerCopy" class="inventory-history__footer">
      {{ footerCopy }}
    </footer>
  </section>
</template>

<style scoped>
.inventory-history {
  --inventory-history-accent: var(--rt-info, var(--accent));
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 1rem;
  color: var(--ink);
}
.inventory-history__header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
}
.inventory-history__header > div { min-width: min(100%, 16rem); }
.inventory-history__eyebrow,
.inventory-history__intro,
.inventory-history__header h3,
.inventory-history__state p,
.inventory-history__fact p,
.inventory-history__fact h4,
.inventory-history__footer,
.inventory-history__error,
.inventory-history__refreshing { margin: 0; }
.inventory-history__eyebrow {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.inventory-history__header h3 {
  margin-top: 0.2rem;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.35rem;
  letter-spacing: 0.03em;
}
.inventory-history__intro {
  margin-top: 0.25rem;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.45;
}
.inventory-history__refresh {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--rule-active);
  border-radius: 6px;
  background: var(--paper-soft);
  color: var(--ink-bright);
  cursor: pointer;
  padding: 0.55rem 0.75rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
}
.inventory-history__refresh:hover:not(:disabled) { border-color: var(--rt-focus); }
.inventory-history__refresh:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}
.inventory-history__refresh:disabled { color: var(--ink-muted); cursor: wait; }
.inventory-history__error,
.inventory-history__refreshing {
  border-left: 3px solid var(--rt-danger);
  background: var(--paper-inset);
  padding: 0.65rem 0.75rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.45;
}
.inventory-history__refreshing { border-left-color: var(--rt-focus); }
.inventory-history__state {
  display: flex;
  min-height: 8rem;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  border: 1px dashed var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
  padding: 1rem;
  color: var(--ink-soft);
  text-align: center;
}
.inventory-history__list {
  position: relative;
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.inventory-history__list::before {
  position: absolute;
  top: 1.4rem;
  bottom: 1.4rem;
  left: 1.35rem;
  width: 1px;
  background: var(--rule-active);
  content: '';
}
.inventory-history__fact {
  --fact-accent: var(--rt-info, var(--accent));
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.8rem 0;
}
.inventory-history__fact + .inventory-history__fact { border-top: 1px solid var(--rule-soft); }
.inventory-history__fact--purchase,
.inventory-history__fact--item-use,
.inventory-history__fact--guided-outcome,
.inventory-history__fact--settlement-award { --fact-accent: var(--rt-success, var(--good)); }
.inventory-history__fact--equipment-change { --fact-accent: var(--rt-info, var(--accent)); }
.inventory-history__fact--transfer { --fact-accent: var(--rt-focus, var(--accent)); }
.inventory-history__fact--discard { --fact-accent: var(--rt-danger, var(--bad)); }
.inventory-history__fact--gm-correction { --fact-accent: var(--rt-pending, var(--warn)); }
.inventory-history__icon {
  z-index: 1;
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid var(--fact-accent);
  border-radius: 50%;
  background: var(--paper);
  color: var(--fact-accent);
}
.inventory-history__fact article { min-width: 0; }
.inventory-history__fact-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem 0.75rem;
}
.inventory-history__fact-header p {
  color: var(--fact-accent);
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.inventory-history__fact time {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.inventory-history__fact h4 {
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1rem;
  line-height: 1.35;
}
.inventory-history__details {
  display: grid;
  gap: 0.2rem;
  margin: 0.3rem 0 0;
  padding: 0;
  list-style: none;
}
.inventory-history__details li {
  overflow-wrap: anywhere;
  color: var(--ink-soft);
  font-size: 0.78rem;
  line-height: 1.45;
}
.inventory-history__footer {
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.75rem;
  color: var(--ink-muted);
  font-size: 0.74rem;
}
@media (max-width: 560px) {
  .inventory-history { padding: 0.85rem; }
  .inventory-history__header,
  .inventory-history__refresh { width: 100%; }
  .inventory-history__fact-header { display: grid; }
}
</style>
