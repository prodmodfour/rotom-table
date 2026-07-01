<script setup lang="ts">
import { computed } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import ShopEntryTable from '~/components/shops/ShopEntryTable.vue'
import ShopPurchaseAuditLog from '~/components/shops/ShopPurchaseAuditLog.vue'
import { useGmShopEditorPage } from '~/composables/shops/useGmShopEditorPage'
import { routeSlugParam } from '~/utils/routeParams'
import { shopfrontPath, shopLibraryPath } from '~/utils/shopRoutes'
import {
  SHOP_DELIVERY_TARGET_KINDS,
  SHOP_PAYMENT_SOURCE_KINDS,
  type ShopDeliveryTargetKind,
  type ShopPaymentSourceKind,
} from '~/types/shop'

interface ShopKindOption<TKind extends string> {
  readonly kind: TKind
  readonly label: string
  readonly description: string
}

const paymentSourceOptions: readonly ShopKindOption<ShopPaymentSourceKind>[] = SHOP_PAYMENT_SOURCE_KINDS.map((kind) => ({
  kind,
  label: kind === 'trainer' ? 'Trainer sheets' : 'Shared group inventory',
  description: kind === 'trainer'
    ? 'Allow checkout money to come from trainer sheets.'
    : 'Allow checkout money to come from the shared group inventory.',
}))

const deliveryTargetOptions: readonly ShopKindOption<ShopDeliveryTargetKind>[] = SHOP_DELIVERY_TARGET_KINDS.map((kind) => ({
  kind,
  label: kind === 'trainer' ? 'Trainer sheets' : 'Shared group inventory',
  description: kind === 'trainer'
    ? 'Allow purchased items to be delivered to trainer sheets.'
    : 'Allow purchased items to be delivered to the shared group inventory.',
}))

definePageMeta({
  middleware: (to) => {
    const { isPlayer } = useAuth()
    if (!isPlayer.value) return

    const slug = routeSlugParam(to.params)
    return navigateTo(slug ? shopfrontPath(slug) : shopLibraryPath(), { replace: true })
  },
})

const route = useRoute()
const { isGm } = useAuth()

const shopSlug = computed(() => routeSlugParam(route.params))
const shopfrontLocation = computed(() => (
  shopSlug.value ? shopfrontPath(shopSlug.value) : shopLibraryPath()
))

const {
  draft,
  loadStatus,
  loadErrorMessage,
  saveStatus,
  saveErrorMessage,
  deleteStatus,
  deleteErrorMessage,
  isDirty,
  canSave,
  canDelete,
  setEntries,
  loadShop,
  saveShop,
  deleteShop,
} = useGmShopEditorPage({ isGm, slug: shopSlug })

const titleTarget = computed(() => draft.value?.name || shopSlug.value || 'shop')
const revisionLabel = computed(() => (
  draft.value ? `Revision ${draft.value.revision}` : 'No revision loaded'
))
const saveButtonLabel = computed(() => {
  if (saveStatus.value === 'saving') return 'Saving shop…'
  if (!isDirty.value) return 'Saved'
  return 'Save shop'
})
const deleteButtonLabel = computed(() => (
  deleteStatus.value === 'deleting' ? 'Deleting shop…' : 'Delete shop table'
))

const deleteCurrentShop = async () => {
  const currentShop = draft.value
  if (!currentShop) return

  const confirmed = import.meta.client
    ? window.confirm(`Delete ${currentShop.name || currentShop.slug}? This cannot be undone.`)
    : true
  if (!confirmed) return

  const deleted = await deleteShop()
  if (deleted) await navigateTo(shopLibraryPath())
}

useHead(() => ({
  title: `${draft.value?.name ?? shopSlug.value ?? 'Edit shop'} · Rotom Table`,
  meta: [
    {
      name: 'description',
      content: 'GM shop editor for Rotom Table live-play campaigns.',
    },
  ],
}))
</script>

<template>
  <main class="shop-edit-page">
    <AppNavigation />

    <header class="shop-edit-hero panel-card">
      <div>
        <p class="shop-edit-eyebrow">GM shop editor</p>
        <h1>Edit {{ titleTarget }}</h1>
        <p>
          Manage campaign shop metadata and entry rows through revision-checked setup saves. Player checkout will remain separate from this editor.
        </p>
        <p class="shop-edit-revision">
          {{ revisionLabel }}
        </p>
      </div>
      <div class="shop-edit-actions" aria-label="Shop editor navigation">
        <NuxtLink class="shop-edit-action" :to="shopfrontLocation">
          Preview shopfront
        </NuxtLink>
        <NuxtLink class="shop-edit-action" :to="shopLibraryPath()">
          Back to shops
        </NuxtLink>
      </div>
    </header>

    <section v-if="!isGm" class="shop-edit-panel shop-edit-panel--warning panel-card" role="status">
      <p class="shop-edit-eyebrow">GM access required</p>
      <h2>Shop editing is unavailable</h2>
      <p>Only GM users can access the shop editor route.</p>
    </section>

    <section
      v-else-if="loadStatus === 'loading'"
      class="shop-edit-panel panel-card"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="shop-edit-eyebrow">Loading</p>
      <h2>Loading shop table…</h2>
      <p>Loading the authoritative shop document before editing.</p>
    </section>

    <section v-else-if="loadStatus === 'error'" class="shop-edit-panel shop-edit-panel--error panel-card" role="alert">
      <p class="shop-edit-eyebrow">Unavailable</p>
      <h2>Could not load shop table</h2>
      <p>{{ loadErrorMessage ?? 'The shop table could not be loaded.' }}</p>
      <button type="button" class="shop-edit-button" @click="loadShop">
        Retry loading shop
      </button>
    </section>

    <form v-else-if="draft" class="shop-edit-form" @submit.prevent="saveShop">
      <section class="shop-edit-panel panel-card" aria-labelledby="shop-edit-details-title">
        <div>
          <p class="shop-edit-eyebrow">Shop details</p>
          <h2 id="shop-edit-details-title">Metadata</h2>
          <p>These setup fields control how the shop appears before live-play checkout commands are available.</p>
        </div>

        <label class="shop-edit-field">
          <span>Name</span>
          <input
            v-model.trim="draft.name"
            data-testid="shop-editor-name"
            type="text"
            autocomplete="off"
            required
          />
        </label>

        <label class="shop-edit-field">
          <span>Description</span>
          <textarea
            v-model.trim="draft.description"
            data-testid="shop-editor-description"
            rows="3"
            placeholder="Shown on the player-facing shopfront."
          ></textarea>
        </label>

        <div class="shop-edit-toggle-grid" aria-label="Shop visibility controls">
          <label class="shop-edit-check-card">
            <input v-model="draft.playerVisible" data-testid="shop-editor-player-visible" type="checkbox" />
            <span>
              <strong>Player visible</strong>
              <small>Players can discover this shop when it is also open.</small>
            </span>
          </label>
          <label class="shop-edit-check-card">
            <input v-model="draft.open" data-testid="shop-editor-open" type="checkbox" />
            <span>
              <strong>Open</strong>
              <small>Open shops are eligible for player browsing when visible.</small>
            </span>
          </label>
        </div>
      </section>

      <section class="shop-edit-panel panel-card" aria-labelledby="shop-edit-rules-title">
        <div>
          <p class="shop-edit-eyebrow">Checkout rules</p>
          <h2 id="shop-edit-rules-title">Allowed sources and targets</h2>
          <p>These options define the payment and delivery choices later live-play checkout commands may offer.</p>
        </div>

        <fieldset class="shop-edit-fieldset">
          <legend>Allowed payment sources</legend>
          <label
            v-for="option in paymentSourceOptions"
            :key="option.kind"
            class="shop-edit-check-card"
          >
            <input
              v-model="draft.allowedPaymentSources"
              data-testid="shop-editor-payment-source"
              type="checkbox"
              :value="option.kind"
            />
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </label>
        </fieldset>

        <fieldset class="shop-edit-fieldset">
          <legend>Allowed delivery targets</legend>
          <label
            v-for="option in deliveryTargetOptions"
            :key="option.kind"
            class="shop-edit-check-card"
          >
            <input
              v-model="draft.allowedDeliveryTargets"
              data-testid="shop-editor-delivery-target"
              type="checkbox"
              :value="option.kind"
            />
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </label>
        </fieldset>
      </section>

      <ShopEntryTable :entries="draft.entries" @update:entries="setEntries" />

      <section class="shop-edit-panel panel-card" aria-labelledby="shop-edit-notes-title">
        <div>
          <p class="shop-edit-eyebrow">Private notes</p>
          <h2 id="shop-edit-notes-title">GM notes</h2>
          <p>GM notes stay on the setup document and are not intended for the player-facing shopfront.</p>
        </div>
        <label class="shop-edit-field">
          <span>GM notes</span>
          <textarea
            v-model.trim="draft.gmNotes"
            data-testid="shop-editor-gm-notes"
            rows="4"
            placeholder="Private notes for this shop table."
          ></textarea>
        </label>
      </section>

      <ShopPurchaseAuditLog class="shop-edit-panel panel-card" :entries="draft.purchaseLog ?? []" />

      <section class="shop-edit-panel panel-card" aria-labelledby="shop-edit-save-title">
        <div>
          <p class="shop-edit-eyebrow">Revision-checked save</p>
          <h2 id="shop-edit-save-title">Save changes</h2>
          <p>Saving sends the loaded revision as <code>expectedRevision</code> and adopts the authoritative response.</p>
        </div>

        <div class="shop-edit-save-row">
          <button
            type="submit"
            class="shop-edit-button shop-edit-button--primary"
            data-testid="shop-editor-save"
            :disabled="!canSave"
          >
            {{ saveButtonLabel }}
          </button>
          <button
            v-if="saveStatus === 'conflict'"
            type="button"
            class="shop-edit-button"
            data-testid="shop-editor-reload-conflict"
            @click="loadShop"
          >
            Reload latest shop
          </button>
        </div>

        <p v-if="saveStatus === 'saved'" class="shop-edit-inline-status shop-edit-inline-status--good" role="status">
          Shop saved. The editor is now using the authoritative server revision.
        </p>
        <p v-else-if="saveStatus === 'conflict'" class="shop-edit-inline-status shop-edit-inline-status--warn" role="alert">
          {{ saveErrorMessage ?? 'This shop changed on the server. Reload latest shop before saving again.' }}
        </p>
        <p v-else-if="saveStatus === 'error'" class="shop-edit-inline-status shop-edit-inline-status--bad" role="alert">
          {{ saveErrorMessage ?? 'The shop table could not be saved.' }}
        </p>
        <p v-else-if="!isDirty" class="shop-edit-inline-status" role="status">
          No unsaved changes.
        </p>
      </section>

      <section class="shop-edit-panel shop-edit-panel--danger panel-card" aria-labelledby="shop-edit-delete-title">
        <div>
          <p class="shop-edit-eyebrow">Danger zone</p>
          <h2 id="shop-edit-delete-title">Delete shop table</h2>
          <p>Deleting uses the loaded revision and removes the campaign shop table document.</p>
        </div>
        <button
          type="button"
          class="shop-edit-button shop-edit-button--danger"
          data-testid="shop-editor-delete"
          :disabled="!canDelete"
          @click="deleteCurrentShop"
        >
          {{ deleteButtonLabel }}
        </button>
        <p v-if="deleteStatus === 'error'" class="shop-edit-inline-status shop-edit-inline-status--bad" role="alert">
          {{ deleteErrorMessage ?? 'The shop table could not be deleted.' }}
        </p>
      </section>
    </form>

    <section v-else class="shop-edit-panel panel-card" role="status">
      <p class="shop-edit-eyebrow">No shop loaded</p>
      <h2>Shop table unavailable</h2>
      <p>Return to the shop library or retry loading this shop before editing.</p>
      <button type="button" class="shop-edit-button" @click="loadShop">
        Retry loading shop
      </button>
    </section>
  </main>
</template>

<style scoped>
.shop-edit-page {
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

.shop-edit-hero,
.shop-edit-panel,
.shop-edit-form {
  display: grid;
  gap: 0.7rem;
}

.shop-edit-hero p,
.shop-edit-panel p {
  max-width: 72ch;
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.shop-edit-eyebrow {
  margin: 0;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.shop-edit-hero h1,
.shop-edit-panel h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.shop-edit-hero h1 {
  font-size: clamp(2rem, 5vw, 3.4rem);
}

.shop-edit-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.shop-edit-revision {
  font-family: var(--font-mono);
  font-size: 0.86rem;
}

.shop-edit-actions,
.shop-edit-save-row,
.shop-edit-toggle-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.shop-edit-action,
.shop-edit-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-decoration: none;
  text-transform: uppercase;
}

.shop-edit-action:hover,
.shop-edit-action:focus-visible,
.shop-edit-button:hover,
.shop-edit-button:focus-visible {
  border-color: var(--rule-active);
  background: var(--paper-hover);
  outline: none;
}

.shop-edit-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.shop-edit-button--primary {
  border-color: color-mix(in srgb, var(--good) 40%, var(--rule-soft));
  color: var(--good);
}

.shop-edit-button--danger {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  color: var(--bad);
}

.shop-edit-panel--warning {
  border-color: color-mix(in srgb, var(--warn) 55%, var(--rule-soft));
}

.shop-edit-panel--error,
.shop-edit-panel--danger {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
}

.shop-edit-field,
.shop-edit-fieldset {
  display: grid;
  gap: 0.35rem;
}

.shop-edit-field span,
.shop-edit-fieldset legend {
  color: var(--ink-bright);
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.shop-edit-field input,
.shop-edit-field textarea {
  width: 100%;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
}

.shop-edit-field input:focus,
.shop-edit-field textarea:focus {
  border-color: var(--rule-active);
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.16);
}

.shop-edit-field textarea {
  resize: vertical;
}

.shop-edit-fieldset {
  min-width: min(100%, 22rem);
  margin: 0;
  border: 1px solid var(--rule-soft);
  padding: 0.75rem;
}

.shop-edit-check-card {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  padding: 0.7rem;
}

.shop-edit-check-card input {
  margin-top: 0.2rem;
}

.shop-edit-check-card span {
  display: grid;
  gap: 0.2rem;
}

.shop-edit-check-card strong {
  color: var(--ink-bright);
}

.shop-edit-check-card small {
  color: var(--ink-soft);
  line-height: 1.45;
}

.shop-edit-inline-status {
  max-width: 72ch;
  margin: 0;
  color: var(--ink-soft);
}

.shop-edit-inline-status--good {
  color: var(--good);
}

.shop-edit-inline-status--warn {
  color: var(--warn);
}

.shop-edit-inline-status--bad {
  color: var(--bad);
}
</style>
