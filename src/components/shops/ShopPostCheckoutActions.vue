<script setup lang="ts">
import { computed } from 'vue'
import {
  PhArrowClockwise,
  PhArrowRight,
  PhCheck,
  PhCheckCircle,
  PhGift,
  PhMagnifyingGlass,
  PhPlay,
  PhTShirt,
} from '@phosphor-icons/vue'
import type {
  ShopCheckoutContinuationReceiptV1,
  ShopPostCheckoutActionKind,
  ShopPostCheckoutActionProjectionStatus,
  ShopPostCheckoutActionProjectionV1,
  ShopPostCheckoutActionV1,
} from '#shared/shopPostCheckout'

const props = defineProps<{
  receipt: ShopCheckoutContinuationReceiptV1
  projection?: ShopPostCheckoutActionProjectionV1 | null
  status: ShopPostCheckoutActionProjectionStatus
  error?: string | null
}>()

const emit = defineEmits<{
  retry: []
  dismiss: []
}>()

const items = computed(() => props.receipt.continuations.map(receipt => ({
  receipt,
  projected: props.projection?.items.find(item => item.continuationId === receipt.continuationId) ?? null,
})))

const iconFor = (kind: ShopPostCheckoutActionKind) => ({
  inspect: PhMagnifyingGlass,
  use: PhPlay,
  equip: PhTShirt,
  give: PhGift,
  'move-to-group': PhArrowRight,
  'transfer-to-trainer': PhArrowRight,
}[kind])

const sourceLabel = (item: typeof props.receipt.continuations[number]): string => (
  `${item.source.containerLabel} · ${item.source.sectionLabel} · ${item.source.rowLabel}`
)
const actionTitle = (action: ShopPostCheckoutActionV1): string => (
  action.enabled ? `${action.label}. Opens the exact current inventory decision.` : action.unavailableReason ?? action.label
)
</script>

<template>
  <section class="post-checkout" aria-labelledby="post-checkout-title">
    <header class="post-checkout__accepted">
      <PhCheckCircle :size="34" weight="fill" aria-hidden="true" />
      <div>
        <h3>Checkout accepted</h3>
        <p>Money, delivery, stock, and the purchase receipt are authoritative.</p>
      </div>
    </header>

    <div class="post-checkout__heading">
      <div>
        <h3 id="post-checkout-title">Purchased items</h3>
        <p>Continue from the exact accepted delivery. Nothing changes until the destination action is confirmed.</p>
      </div>
      <span v-if="status === 'loading'" class="post-checkout__loading" role="status" aria-live="polite">
        Checking current actions…
      </span>
    </div>

    <p v-if="status === 'error'" class="post-checkout__error" role="alert">
      {{ error ?? 'Exact post-checkout action options could not be loaded.' }}
    </p>

    <div class="post-checkout__items">
      <article v-for="item in items" :key="item.receipt.continuationId" class="post-checkout__item">
        <header class="post-checkout__item-header">
          <span class="post-checkout__item-mark" aria-hidden="true">
            {{ item.receipt.itemLabel.slice(0, 1).toUpperCase() }}
          </span>
          <div>
            <h4>{{ item.receipt.itemLabel }} <span>×{{ item.receipt.quantity }}</span></h4>
            <p>{{ sourceLabel(item.receipt) }}</p>
          </div>
        </header>

        <div v-if="item.projected" class="post-checkout__actions" :aria-label="`${item.receipt.itemLabel} next actions`">
          <template v-for="action in item.projected.actions" :key="action.actionId">
            <NuxtLink
              v-if="action.enabled && action.href"
              class="post-checkout__action"
              :class="{ 'post-checkout__action--use': action.kind === 'use' }"
              :to="action.href"
              :title="actionTitle(action)"
            >
              <component :is="iconFor(action.kind)" :size="18" weight="bold" aria-hidden="true" />
              <span>{{ action.label }}</span>
            </NuxtLink>
            <button
              v-else
              type="button"
              class="post-checkout__action"
              :title="actionTitle(action)"
              disabled
            >
              <component :is="iconFor(action.kind)" :size="18" weight="bold" aria-hidden="true" />
              <span>{{ action.label }}</span>
            </button>
            <p v-if="!action.enabled" class="post-checkout__reason">
              {{ action.unavailableReason }}
            </p>
          </template>
        </div>
        <p v-else-if="status === 'loading'" class="post-checkout__item-status" role="status">
          Reauthorising this exact delivered source…
        </p>
        <p v-else class="post-checkout__item-status">
          Retry action options to reauthorise this delivered source.
        </p>

        <p v-if="item.projected?.destinationSummary" class="post-checkout__destination">
          <PhCheck :size="16" weight="bold" aria-hidden="true" />
          {{ item.projected.destinationSummary }}
        </p>
      </article>
    </div>

    <footer class="post-checkout__footer">
      <button type="button" class="post-checkout__footer-action" @click="emit('dismiss')">
        <PhCheck :size="18" weight="bold" aria-hidden="true" />
        Done shopping
      </button>
      <button
        type="button"
        class="post-checkout__footer-action"
        :disabled="status === 'loading'"
        @click="emit('retry')"
      >
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        {{ status === 'loading' ? 'Checking action options…' : 'Retry action options' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.post-checkout {
  display: grid;
  gap: 1rem;
  border: 1px solid color-mix(in srgb, var(--good) 45%, var(--rule-soft));
  border-left: 4px solid var(--good);
  background: var(--paper);
  padding: 1rem;
}
.post-checkout__accepted,
.post-checkout__heading,
.post-checkout__item-header,
.post-checkout__footer,
.post-checkout__action,
.post-checkout__destination {
  display: flex;
  align-items: center;
}
.post-checkout__accepted { gap: 0.75rem; color: var(--good); }
.post-checkout__accepted div,
.post-checkout__heading div,
.post-checkout__item-header div { min-width: 0; }
.post-checkout h3,
.post-checkout h4,
.post-checkout p { margin: 0; }
.post-checkout h3,
.post-checkout h4 { color: var(--ink-bright); font-family: var(--font-book); letter-spacing: 0.03em; }
.post-checkout h3 { font-size: 1.2rem; }
.post-checkout h4 { font-size: 1.05rem; }
.post-checkout h4 span { color: var(--ink-soft); font-family: var(--font-mono); font-size: 0.86rem; }
.post-checkout p { color: var(--ink-soft); line-height: 1.45; }
.post-checkout__heading {
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 1rem;
}
.post-checkout__loading { color: var(--rt-focus); font-size: 0.8rem; font-weight: 800; }
.post-checkout__error {
  border: 1px solid color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  background: var(--paper-inset);
  padding: 0.75rem;
}
.post-checkout__items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--rule-soft); }
.post-checkout__item { display: grid; align-content: start; gap: 0.8rem; padding: 1rem; }
.post-checkout__item + .post-checkout__item { border-left: 1px solid var(--rule-soft); }
.post-checkout__item-header { gap: 0.75rem; }
.post-checkout__item-mark {
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.4rem;
  font-weight: 800;
}
.post-checkout__actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.45rem; }
.post-checkout__action {
  min-height: 2.75rem;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 5px;
  background: var(--paper-inset);
  color: var(--ink-soft);
  padding: 0.55rem 0.7rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  text-decoration: none;
}
.post-checkout__action--use { color: var(--rt-focus); }
.post-checkout__action:hover:not(:disabled),
.post-checkout__action:focus-visible {
  border-color: var(--rt-focus);
  color: var(--ink-bright);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}
.post-checkout__action:disabled { color: var(--ink-faint); cursor: not-allowed; }
.post-checkout__reason { flex-basis: 100%; font-size: 0.76rem; }
.post-checkout__item-status { font-size: 0.8rem; }
.post-checkout__destination { gap: 0.4rem; color: var(--good) !important; font-size: 0.8rem; }
.post-checkout__footer {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 1rem;
}
.post-checkout__footer-action {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 5px;
  background: var(--paper-inset);
  color: var(--ink-bright);
  padding: 0.55rem 0.85rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 800;
  cursor: pointer;
}
.post-checkout__footer-action:hover:not(:disabled),
.post-checkout__footer-action:focus-visible { border-color: var(--rt-focus); outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.post-checkout__footer-action:disabled { color: var(--ink-faint); cursor: wait; }

@media (max-width: 760px) {
  .post-checkout { padding: 0.75rem; }
  .post-checkout__heading { display: grid; }
  .post-checkout__items { grid-template-columns: minmax(0, 1fr); }
  .post-checkout__item + .post-checkout__item { border-top: 1px solid var(--rule-soft); border-left: 0; }
  .post-checkout__action { flex: 1 1 9rem; }
  .post-checkout__footer { display: grid; }
  .post-checkout__footer-action { width: 100%; }
}
</style>
