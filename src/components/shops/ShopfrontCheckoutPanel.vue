<script setup lang="ts">
import type { ShopCheckoutCommandOutboxEntry } from '~/utils/livePlayCommandOutbox'
import type {
  ShopfrontCartLine,
  ShopfrontCheckoutDocumentsStatus,
  ShopfrontCheckoutParticipantOption,
} from '~/composables/shops/useShopfrontCheckout'
import type {
  ShopCheckoutCommandStatus,
  ShopCheckoutOutboxStatus,
} from '~/composables/shops/useShopCheckoutCommands'

const props = defineProps<{
  cartLines: readonly ShopfrontCartLine[]
  totalPrice: number
  paymentOptions: readonly ShopfrontCheckoutParticipantOption[]
  deliveryOptions: readonly ShopfrontCheckoutParticipantOption[]
  selectedPaymentOptionKey: string
  selectedDeliveryOptionKey: string
  documentsStatus: ShopfrontCheckoutDocumentsStatus
  documentsErrorMessage?: string | null
  checkoutStatus: ShopCheckoutCommandStatus
  checkoutErrorMessage?: string | null
  checkoutUnavailableReason?: string | null
  canCheckout: boolean
  pendingOutboxEntries: readonly ShopCheckoutCommandOutboxEntry[]
  outboxStatus: ShopCheckoutOutboxStatus
  outboxError?: string | null
  selectedProfileDisplayName?: string | null
}>()

const emit = defineEmits<{
  'update-payment-option': [optionKey: string]
  'update-delivery-option': [optionKey: string]
  checkout: []
  'retry-outbox-entry': [opId: string]
  'discard-outbox-entry': [opId: string]
  'reload-documents': []
  'clear-error': []
}>()

const currency = (value: number): string => `$${value.toLocaleString('en-US')}`

const optionLabel = (option: ShopfrontCheckoutParticipantOption): string => {
  const moneyLabel = option.money === undefined ? '' : ` · ${currency(option.money)} available`
  return `${option.label}${moneyLabel}`
}

const statusTitle = (): string | null => {
  switch (props.checkoutStatus) {
    case 'sending':
      return 'Sending checkout command…'
    case 'accepted':
      return 'Checkout accepted'
    case 'rejected':
      return 'Checkout rejected'
    case 'stale':
      return 'Checkout needs a refresh'
    case 'uncertain':
      return 'Checkout outcome uncertain'
    case 'error':
      return 'Checkout unavailable'
    case 'idle':
      return null
  }
}

const statusMessage = (): string | null => {
  switch (props.checkoutStatus) {
    case 'sending':
      return 'The live-play checkout command is in flight. Keep this page open until a terminal result is received.'
    case 'accepted':
      return 'Purchase accepted. The authoritative shop stock and delivery documents were adopted from the server response.'
    case 'rejected':
    case 'stale':
    case 'uncertain':
    case 'error':
      return props.checkoutErrorMessage ?? 'The checkout command could not be completed.'
    case 'idle':
      return null
  }
}

const statusRole = (): 'status' | 'alert' => (
  props.checkoutStatus === 'rejected'
  || props.checkoutStatus === 'stale'
  || props.checkoutStatus === 'uncertain'
  || props.checkoutStatus === 'error'
    ? 'alert'
    : 'status'
)

const checkoutButtonLabel = (): string => {
  if (props.checkoutStatus === 'sending') return 'Sending checkout…'
  if (props.totalPrice > 0) return `Buy for ${currency(props.totalPrice)}`
  return 'Buy selected items'
}

const pendingEntryLabel = (entry: ShopCheckoutCommandOutboxEntry): string => (
  `${entry.opId} · ${entry.state} · ${entry.attemptCount} ${entry.attemptCount === 1 ? 'attempt' : 'attempts'}`
)

const eventSelectValue = (event: Event): string => (event.target as HTMLSelectElement | null)?.value ?? ''

const handlePaymentOptionChange = (event: Event): void => {
  emit('update-payment-option', eventSelectValue(event))
}

const handleDeliveryOptionChange = (event: Event): void => {
  emit('update-delivery-option', eventSelectValue(event))
}
</script>

<template>
  <section class="shopfront-checkout panel-card" data-testid="shopfront-checkout" aria-labelledby="shopfront-checkout-title">
    <header class="shopfront-checkout__header">
      <div>
        <p class="shopfront-checkout__eyebrow">Live-play checkout</p>
        <h2 id="shopfront-checkout-title">Cart and checkout</h2>
        <p>
          Purchases are dispatched as idempotent live-play commands. Money, inventory, and stock update only after the server accepts the command.
        </p>
      </div>
      <button
        type="button"
        class="shopfront-checkout__action shopfront-checkout__action--secondary"
        :disabled="documentsStatus === 'loading'"
        @click="emit('reload-documents')"
      >
        {{ documentsStatus === 'loading' ? 'Loading checkout options…' : 'Reload checkout options' }}
      </button>
    </header>

    <p v-if="selectedProfileDisplayName" class="shopfront-checkout__profile" data-testid="shopfront-selected-profile">
      Player profile: <strong>{{ selectedProfileDisplayName }}</strong>
    </p>

    <p v-if="documentsErrorMessage" class="shopfront-checkout__message shopfront-checkout__message--error" role="alert">
      {{ documentsErrorMessage }}
    </p>

    <section class="shopfront-checkout__cart" aria-label="Cart summary">
      <h3>Cart summary</h3>
      <p v-if="cartLines.length === 0" class="shopfront-checkout__empty" role="status">
        Your cart is empty. Set item quantities in the catalog above to prepare a purchase.
      </p>
      <ul v-else class="shopfront-checkout__cart-list" data-testid="shopfront-cart-lines">
        <li v-for="line in cartLines" :key="line.entry.id">
          <span>{{ line.quantity }} × {{ line.entry.itemName || 'Unnamed item' }}</span>
          <span>{{ currency(line.lineTotal) }}</span>
        </li>
      </ul>
      <p class="shopfront-checkout__total" data-testid="shopfront-cart-total">
        Total: <strong>{{ currency(totalPrice) }}</strong>
      </p>
    </section>

    <form class="shopfront-checkout__form" @submit.prevent="emit('checkout')">
      <label class="shopfront-checkout__field">
        <span>Payment source</span>
        <select
          data-testid="shopfront-payment-source"
          :value="selectedPaymentOptionKey"
          :disabled="checkoutStatus === 'sending' || paymentOptions.length === 0"
          @change="handlePaymentOptionChange"
        >
          <option v-if="paymentOptions.length === 0" value="">
            No eligible payment sources
          </option>
          <option v-for="option in paymentOptions" :key="option.key" :value="option.key">
            {{ optionLabel(option) }}
          </option>
        </select>
      </label>

      <label class="shopfront-checkout__field">
        <span>Delivery target</span>
        <select
          data-testid="shopfront-delivery-target"
          :value="selectedDeliveryOptionKey"
          :disabled="checkoutStatus === 'sending' || deliveryOptions.length === 0"
          @change="handleDeliveryOptionChange"
        >
          <option v-if="deliveryOptions.length === 0" value="">
            No eligible delivery targets
          </option>
          <option v-for="option in deliveryOptions" :key="option.key" :value="option.key">
            {{ optionLabel(option) }}
          </option>
        </select>
      </label>

      <p v-if="checkoutUnavailableReason" class="shopfront-checkout__hint" data-testid="shopfront-checkout-unavailable">
        {{ checkoutUnavailableReason }}
      </p>

      <button
        type="submit"
        class="shopfront-checkout__action shopfront-checkout__action--primary"
        data-testid="shopfront-buy"
        :disabled="!canCheckout"
      >
        {{ checkoutButtonLabel() }}
      </button>
    </form>

    <article
      v-if="statusTitle()"
      class="shopfront-checkout__message"
      :class="`shopfront-checkout__message--${checkoutStatus}`"
      :role="statusRole()"
      aria-live="polite"
      data-testid="shopfront-checkout-status"
    >
      <h3>{{ statusTitle() }}</h3>
      <p>{{ statusMessage() }}</p>
      <button
        v-if="checkoutStatus === 'rejected' || checkoutStatus === 'stale' || checkoutStatus === 'error'"
        type="button"
        class="shopfront-checkout__action shopfront-checkout__action--secondary"
        @click="emit('clear-error')"
      >
        Clear checkout message
      </button>
    </article>

    <section v-if="pendingOutboxEntries.length > 0 || outboxError" class="shopfront-checkout__outbox" aria-label="Pending checkout recovery">
      <h3>Pending checkout commands</h3>
      <p v-if="outboxError" class="shopfront-checkout__message shopfront-checkout__message--error" role="alert">
        {{ outboxError }}
      </p>
      <ul v-if="pendingOutboxEntries.length > 0" class="shopfront-checkout__pending-list">
        <li v-for="entry in pendingOutboxEntries" :key="entry.opId">
          <span>{{ pendingEntryLabel(entry) }}</span>
          <span v-if="entry.lastError" class="shopfront-checkout__pending-error">{{ entry.lastError }}</span>
          <button
            type="button"
            class="shopfront-checkout__action shopfront-checkout__action--secondary"
            :disabled="outboxStatus === 'retrying' || checkoutStatus === 'sending'"
            @click="emit('retry-outbox-entry', entry.opId)"
          >
            Retry
          </button>
          <button
            type="button"
            class="shopfront-checkout__action shopfront-checkout__action--danger"
            :disabled="outboxStatus === 'discarding' || checkoutStatus === 'sending'"
            @click="emit('discard-outbox-entry', entry.opId)"
          >
            Discard local pending command
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.shopfront-checkout {
  display: grid;
  gap: 1rem;
}

.shopfront-checkout__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
}

.shopfront-checkout__header p,
.shopfront-checkout__profile,
.shopfront-checkout__empty,
.shopfront-checkout__hint,
.shopfront-checkout__message p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.shopfront-checkout__eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shopfront-checkout h2,
.shopfront-checkout h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shopfront-checkout h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shopfront-checkout h3 {
  font-size: 1.05rem;
}

.shopfront-checkout__cart,
.shopfront-checkout__form,
.shopfront-checkout__outbox,
.shopfront-checkout__message {
  display: grid;
  gap: 0.65rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  padding: 0.85rem;
}

.shopfront-checkout__cart-list,
.shopfront-checkout__pending-list {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.shopfront-checkout__cart-list li,
.shopfront-checkout__pending-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  padding: 0.55rem;
}

.shopfront-checkout__total {
  margin: 0;
  color: var(--ink-bright);
  font-size: 1.05rem;
}

.shopfront-checkout__field {
  display: grid;
  gap: 0.35rem;
  color: var(--ink-soft);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shopfront-checkout__field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 0.4rem;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  padding: 0.55rem;
  text-transform: none;
}

.shopfront-checkout__action {
  justify-self: start;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-transform: uppercase;
}

.shopfront-checkout__action--primary {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--rule-soft));
  background: var(--accent);
  color: var(--accent-contrast);
}

.shopfront-checkout__action--danger {
  color: var(--bad);
}

.shopfront-checkout__action:hover,
.shopfront-checkout__action:focus-visible,
.shopfront-checkout__field select:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.shopfront-checkout__action:disabled,
.shopfront-checkout__field select:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.shopfront-checkout__message--accepted {
  border-color: color-mix(in srgb, var(--good) 55%, var(--rule-soft));
}

.shopfront-checkout__message--rejected,
.shopfront-checkout__message--stale,
.shopfront-checkout__message--uncertain,
.shopfront-checkout__message--error {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
}

.shopfront-checkout__pending-error {
  flex-basis: 100%;
  color: var(--bad);
  font-size: 0.82rem;
}

@media (max-width: 680px) {
  .shopfront-checkout__header {
    display: grid;
  }
}
</style>
