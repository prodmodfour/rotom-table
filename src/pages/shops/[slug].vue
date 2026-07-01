<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import ShopfrontCheckoutPanel from '~/components/shops/ShopfrontCheckoutPanel.vue'
import ShopfrontEntryList from '~/components/shops/ShopfrontEntryList.vue'
import { useShopfrontCheckout } from '~/composables/shops/useShopfrontCheckout'
import { useShopfrontPage } from '~/composables/shops/useShopfrontPage'
import { routeSlugParam } from '~/utils/routeParams'
import { shopEditorPath, shopLibraryPath } from '~/utils/shopRoutes'

const route = useRoute()
const { role, isGm, isPlayer } = useAuth()
const {
  selectedProfileId,
  selectedProfileDisplayName,
  loadRememberedProfile,
} = usePlayerProfiles()

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const shopSlug = computed(() => routeSlugParam(route.params))
const shopEditorLocation = computed(() => (
  shopSlug.value ? shopEditorPath(shopSlug.value) : shopLibraryPath()
))

const {
  shop,
  loadStatus,
  loadErrorMessage,
  loadShop,
} = useShopfrontPage({ slug: shopSlug })

const {
  cartQuantities,
  cartLines,
  totalPrice,
  paymentOptions,
  deliveryOptions,
  selectedPaymentOptionKey,
  selectedDeliveryOptionKey,
  documentsStatus,
  documentsErrorMessage,
  checkoutStatus,
  checkoutErrorMessage,
  checkoutUnavailableReason,
  canCheckout,
  pendingOutboxEntries,
  outboxStatus,
  outboxError,
  setCartQuantity,
  selectPaymentOption,
  selectDeliveryOption,
  loadCheckoutDocuments,
  submitCheckout,
  retryOutboxEntry,
  discardOutboxEntry,
  clearCheckoutError,
} = useShopfrontCheckout({
  shop,
  authRole: role,
  isGm,
  isPlayer,
  selectedProfileId,
})

const pageTitle = computed(() => shop.value?.name || shopSlug.value || 'Shop')
const shopStatusLabel = computed(() => (shop.value?.open ? 'Open' : 'Closed'))
const shopVisibilityLabel = computed(() => (shop.value?.playerVisible ? 'Player visible' : 'Hidden'))
const gmPreviewMessage = computed(() => {
  const loadedShop = shop.value
  if (!isGm.value || !loadedShop) return null

  const reasons: string[] = []
  if (!loadedShop.open) reasons.push('closed')
  if (!loadedShop.playerVisible) reasons.push('hidden from players')
  if (reasons.length === 0) return null

  return `GM preview is showing a ${reasons.join(' and ')} shop. Players can only open this page when the shop is both open and player-visible.`
})

useHead(() => ({
  title: `${pageTitle.value} · Rotom Table`,
  meta: [
    {
      name: 'description',
      content: 'Player-facing shopfront with live-play checkout commands for Rotom Table campaigns.',
    },
  ],
}))
</script>

<template>
  <main class="shopfront-page">
    <AppNavigation />

    <header class="shopfront-hero panel-card">
      <div>
        <p class="shopfront-eyebrow">Player shopfront</p>
        <h1>{{ pageTitle }}</h1>
        <p v-if="shop?.description">
          {{ shop.description }}
        </p>
        <p v-else>
          Browse the shop catalog, choose cart quantities, and buy through server-authoritative live-play checkout commands.
        </p>

        <div v-if="shop" class="shopfront-badges" aria-label="Shop state">
          <span
            class="shopfront-badge"
            :class="shop.open ? 'shopfront-badge--good' : 'shopfront-badge--warn'"
          >
            {{ shopStatusLabel }}
          </span>
          <span
            class="shopfront-badge"
            :class="shop.playerVisible ? 'shopfront-badge--good' : 'shopfront-badge--warn'"
          >
            {{ shopVisibilityLabel }}
          </span>
          <span class="shopfront-badge shopfront-badge--neutral">Revision {{ shop.revision }}</span>
        </div>
      </div>
      <div class="shopfront-actions" aria-label="Shopfront navigation">
        <NuxtLink class="shopfront-action" :to="shopLibraryPath()">
          Back to shops
        </NuxtLink>
        <NuxtLink v-if="isGm" class="shopfront-action" :to="shopEditorLocation">
          Open GM editor
        </NuxtLink>
      </div>
    </header>

    <section
      v-if="loadStatus === 'loading'"
      class="shopfront-panel panel-card"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="shopfront-eyebrow">Loading</p>
      <h2>Loading shopfront…</h2>
      <p>Loading the authoritative campaign shop document.</p>
    </section>

    <section v-else-if="loadStatus === 'error'" class="shopfront-panel shopfront-panel--error panel-card" role="alert">
      <p class="shopfront-eyebrow">Unavailable</p>
      <h2>Shopfront unavailable</h2>
      <p>{{ loadErrorMessage ?? 'This shopfront is not available.' }}</p>
      <p>Players can only view shopfronts that are both open and player-visible.</p>
      <div class="shopfront-actions">
        <button type="button" class="shopfront-action shopfront-action--button" @click="loadShop">
          Retry loading shop
        </button>
        <NuxtLink class="shopfront-action" :to="shopLibraryPath()">
          Return to shops
        </NuxtLink>
      </div>
    </section>

    <template v-else-if="shop">
      <section v-if="gmPreviewMessage" class="shopfront-panel shopfront-panel--warning panel-card" role="status">
        <p class="shopfront-eyebrow">GM preview</p>
        <h2>Previewing a private shopfront</h2>
        <p>{{ gmPreviewMessage }}</p>
      </section>

      <ShopfrontEntryList
        :shop="shop"
        :quantities="cartQuantities"
        :disabled="checkoutStatus === 'sending'"
        @update-quantity="setCartQuantity"
      />

      <ShopfrontCheckoutPanel
        :cart-lines="cartLines"
        :total-price="totalPrice"
        :payment-options="paymentOptions"
        :delivery-options="deliveryOptions"
        :selected-payment-option-key="selectedPaymentOptionKey"
        :selected-delivery-option-key="selectedDeliveryOptionKey"
        :documents-status="documentsStatus"
        :documents-error-message="documentsErrorMessage"
        :checkout-status="checkoutStatus"
        :checkout-error-message="checkoutErrorMessage"
        :checkout-unavailable-reason="checkoutUnavailableReason"
        :can-checkout="canCheckout"
        :pending-outbox-entries="pendingOutboxEntries"
        :outbox-status="outboxStatus"
        :outbox-error="outboxError"
        :selected-profile-display-name="selectedProfileDisplayName"
        @update-payment-option="selectPaymentOption"
        @update-delivery-option="selectDeliveryOption"
        @checkout="submitCheckout"
        @retry-outbox-entry="retryOutboxEntry"
        @discard-outbox-entry="discardOutboxEntry"
        @reload-documents="loadCheckoutDocuments"
        @clear-error="clearCheckoutError"
      />
    </template>

    <section v-else class="shopfront-panel panel-card" role="status">
      <p class="shopfront-eyebrow">No shop loaded</p>
      <h2>Shopfront unavailable</h2>
      <p>Return to the shop library or retry loading this shopfront.</p>
      <button type="button" class="shopfront-action shopfront-action--button" @click="loadShop">
        Retry loading shop
      </button>
    </section>
  </main>
</template>

<style scoped>
.shopfront-page {
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

.shopfront-hero,
.shopfront-panel {
  display: grid;
  gap: 0.7rem;
}

.shopfront-hero p,
.shopfront-panel p {
  max-width: 68ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shopfront-eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shopfront-hero h1,
.shopfront-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shopfront-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.shopfront-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shopfront-badges,
.shopfront-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.shopfront-badge {
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

.shopfront-badge--good {
  border-color: color-mix(in srgb, var(--good) 45%, var(--rule-soft));
  color: var(--good);
}

.shopfront-badge--warn {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--rule-soft));
  color: var(--warn);
}

.shopfront-badge--neutral {
  font-family: var(--font-mono);
}

.shopfront-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.shopfront-action--button {
  cursor: pointer;
  font: inherit;
}

.shopfront-action:hover,
.shopfront-action:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.shopfront-panel--error {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
}

.shopfront-panel--warning {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--rule-soft));
}
</style>
