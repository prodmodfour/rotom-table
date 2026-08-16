<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhCheckCircle, PhWarning, PhWarningCircle } from '@phosphor-icons/vue'
import InventoryRecoveryCard, { type InventoryRecoveryState } from '~/components/inventory/InventoryRecoveryCard.vue'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { InventoryActionFlowStatus } from '~/composables/sheets/useTrainerInventoryActionFlows'

const props = withDefaults(defineProps<{
  offer: InventoryActionOfferV1 | null
  selectedDestinationId: string | null
  quantity: number
  selectedConfirmationOptionId?: string | null
  status: InventoryActionFlowStatus
  message: string | null
  busy: boolean
  recoveryOnline?: boolean
  exactRetryAvailable?: boolean
}>(), {
  selectedConfirmationOptionId: null,
  recoveryOnline: true,
  exactRetryAvailable: true,
})
const emit = defineEmits<{
  chooseDestination: [destinationId: string]
  setQuantity: [quantity: number]
  setConfirmation: [accepted: boolean]
  confirm: []
  cancel: []
  retryExact: []
  refresh: []
  dismiss: []
}>()

const heading = ref<HTMLElement | null>(null)
const selectedDestination = computed(() => props.offer?.destination.options
  .find(option => option.destinationId === props.selectedDestinationId) ?? null)
const destinationReady = computed(() => props.offer?.destination.mode !== 'required' || selectedDestination.value?.enabled === true)
const confirmationReady = computed(() => props.offer?.confirmation.mode !== 'explicit-choice'
  || props.selectedConfirmationOptionId === props.offer.confirmation.optionId)
const ready = computed(() => props.status === 'ready' && Boolean(props.offer) && destinationReady.value && confirmationReady.value)
const title = computed(() => {
  if (!props.offer) return props.status === 'uncertain' ? 'Inventory result uncertain' : 'Inventory action'
  if (props.offer.action === 'give') return 'Give whole item'
  if (props.offer.action === 'equip') return 'Equip whole item'
  if (props.offer.action === 'transfer') return 'Transfer items'
  if (props.offer.action === 'split') return 'Split stack'
  if (props.offer.action === 'merge') return 'Merge stacks'
  if (props.offer.action === 'discard') return 'Discard items'
  return props.offer.label
})
const submitLabel = computed(() => {
  if (props.offer?.action === 'give') return 'Give item'
  if (props.offer?.action === 'equip') return 'Equip item'
  if (props.offer?.action === 'split') return 'Split stack'
  if (props.offer?.action === 'merge') return 'Merge stacks'
  if (props.offer?.action === 'discard') return `Discard ${props.quantity} ${props.quantity === 1 ? 'item' : 'items'}`
  return 'Transfer items'
})
const sourcePath = computed(() => props.offer
  ? [props.offer.source.containerLabel, props.offer.source.sectionLabel, props.offer.source.rowLabel].filter(Boolean).join(' · ')
  : '')
const quantitySummary = computed(() => {
  if (!props.offer) return ''
  if (['equip', 'give'].includes(props.offer.action)) return 'Moves 1 whole item'
  if (props.offer.action === 'split') return `Creates a separate stack of ${props.quantity} ${props.quantity === 1 ? 'item' : 'items'}`
  if (props.offer.action === 'merge') return `Merges all ${props.offer.source.availableQuantity} items`
  if (props.offer.action === 'discard') return `Permanently removes ${props.quantity} ${props.quantity === 1 ? 'item' : 'items'}`
  return `Moves ${props.quantity} ${props.quantity === 1 ? 'item' : 'items'}`
})
const availabilitySummary = computed(() => {
  if (!props.offer) return ''
  const available = props.offer.source.availableQuantity
  if (['split', 'discard'].includes(props.offer.action)) {
    const remaining = Math.max(0, available - props.quantity)
    return `${available} currently available · ${remaining} ${remaining === 1 ? 'remains' : 'remain'} after acceptance`
  }
  return `${available} currently available`
})
const recoveryState = computed<InventoryRecoveryState | null>(() => (
  props.status === 'uncertain' || props.status === 'conflict' || props.status === 'error' ? props.status : null
))
const showDecision = computed(() => Boolean(props.offer) && !['accepted', 'uncertain'].includes(props.status))
const confirmationInput = (event: Event) => emit('setConfirmation', (event.target as HTMLInputElement).checked)
const quantityInput = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isSafeInteger(value)) emit('setQuantity', value)
}

watch(
  () => [props.offer?.offerId ?? null, props.status] as const,
  async (next, previous) => {
    if (next[0] === previous?.[0] && next[1] === previous?.[1]) return
    await nextTick()
    heading.value?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <InventoryRecoveryCard
    v-if="recoveryState"
    :state="recoveryState"
    :message="message"
    :online="recoveryOnline"
    :busy="busy"
    :exact-retry-available="exactRetryAvailable"
    @retry-exact="emit('retryExact')"
    @reconcile="emit('refresh')"
  />
  <section v-else class="inventory-action-decision" aria-labelledby="inventory-action-decision-title">
    <header class="inventory-action-decision__header">
      <span class="inventory-action-decision__eyebrow">{{ offer ? `${offer.label} action` : 'Recovery' }}</span>
      <h3 id="inventory-action-decision-title" ref="heading" tabindex="-1">{{ title }}</h3>
      <template v-if="offer">
        <strong>{{ offer.source.itemLabel }}</strong>
        <span>{{ sourcePath }}</span>
        <span class="inventory-action-decision__quantity-summary">{{ quantitySummary }}</span>
      </template>
    </header>

    <div v-if="showDecision && offer" class="inventory-action-decision__body">
      <fieldset v-if="offer.destination.options.length" class="inventory-action-destinations" :disabled="busy">
        <legend>Choose destination</legend>
        <label
          v-for="(destination, index) in offer.destination.options"
          :key="destination.destinationId"
          class="inventory-action-destination"
          :class="{
            'is-selected': destination.destinationId === selectedDestinationId,
            'is-unavailable': !destination.enabled,
          }"
        >
          <input
            :id="`inventory-action-destination-${index}`"
            type="radio"
            name="inventory-action-destination"
            :value="destination.destinationId"
            :checked="destination.destinationId === selectedDestinationId"
            :disabled="!destination.enabled || busy"
            @change="emit('chooseDestination', destination.destinationId)"
          >
          <span class="inventory-action-destination__copy">
            <strong>{{ destination.label }}</strong>
            <small>{{ destination.unavailableReason?.label ?? destination.description }}</small>
          </span>
          <span v-if="destination.destinationId === selectedDestinationId" class="inventory-action-destination__state">Selected</span>
        </label>
      </fieldset>

      <label v-if="offer.quantity.mode === 'bounded' && offer.quantity.maximum && offer.quantity.maximum > 1" class="inventory-action-quantity">
        <span>Quantity</span>
        <input
          type="number"
          inputmode="numeric"
          :min="offer.quantity.minimum ?? 1"
          :max="offer.quantity.maximum"
          :value="quantity"
          :disabled="busy"
          @input="quantityInput"
        >
        <small>{{ availabilitySummary }}</small>
      </label>

      <div
        class="inventory-action-consequences"
        :class="{ 'inventory-action-consequences--danger': offer.action === 'discard' }"
        aria-label="Consequences"
      >
        <PhWarning v-if="offer.action === 'discard'" :size="28" weight="bold" aria-hidden="true" />
        <div>
          <strong>{{ offer.action === 'discard' ? 'Irreversible' : 'On acceptance' }}</strong>
          <ul>
            <li v-for="row in offer.consequences" :key="`${row.kind}:${row.label}`">
              {{ offer.action === 'discard' ? `${quantity} ${quantity === 1 ? 'item' : 'items'} will be permanently removed from this inventory.` : row.label }}
            </li>
          </ul>
        </div>
      </div>
      <label v-if="offer.confirmation.mode === 'explicit-choice'" class="inventory-action-confirmation">
        <input
          type="checkbox"
          :checked="selectedConfirmationOptionId === offer.confirmation.optionId"
          :disabled="busy"
          @change="confirmationInput"
        >
        <span>{{ offer.confirmation.label }}</span>
      </label>
      <p class="inventory-action-revision-note">Source and destination revisions are rechecked when submitted.</p>
    </div>

    <div
      v-if="message"
      class="inventory-action-decision__status"
      :class="`inventory-action-decision__status--${status}`"
      role="status"
      aria-live="polite"
    >
      <PhCheckCircle v-if="status === 'accepted'" :size="22" weight="fill" aria-hidden="true" />
      <PhWarningCircle v-else-if="['uncertain', 'conflict', 'error'].includes(status)" :size="22" weight="fill" aria-hidden="true" />
      <span>{{ message }}</span>
    </div>

    <footer class="inventory-action-decision__footer">
      <template v-if="status === 'accepted'">
        <button type="button" class="inventory-action-button inventory-action-button--primary" @click="emit('dismiss')">Done</button>
      </template>
      <template v-else>
        <button type="button" class="inventory-action-button" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <button
          type="button"
          class="inventory-action-button inventory-action-button--primary"
          :class="{ 'inventory-action-button--danger': offer?.action === 'discard' }"
          :disabled="!ready || busy"
          @click="emit('confirm')"
        >
          {{ busy ? 'Submitting…' : submitLabel }}
        </button>
      </template>
    </footer>
  </section>
</template>

<style scoped>
.inventory-action-decision {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 1rem;
  overflow: hidden;
  border: 1px solid var(--rule-active);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: var(--shadow-card);
  padding: 1rem 1rem 1rem 1.2rem;
}

.inventory-action-decision::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--rt-focus);
  content: '';
}

.inventory-action-decision__header {
  display: grid;
  gap: 0.28rem;
  border-bottom: 1px solid var(--rule-soft);
  padding-bottom: 0.85rem;
  color: var(--ink-soft);
}

.inventory-action-decision__eyebrow {
  color: var(--rt-focus);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.inventory-action-decision h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.35rem, 2.1vw, 1.85rem);
  line-height: 1.1;
}

.inventory-action-decision h3:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--rt-focus);
  outline-offset: 3px;
}

.inventory-action-decision__header strong { color: var(--ink-bright); }
.inventory-action-decision__quantity-summary { color: var(--ink-bright); font-variant-numeric: tabular-nums; }
.inventory-action-decision__body { display: grid; gap: 0.9rem; }

.inventory-action-destinations {
  display: grid;
  gap: 0.55rem;
  margin: 0;
  border: 0;
  padding: 0;
}

.inventory-action-destinations legend {
  margin-bottom: 0.55rem;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
}

.inventory-action-destination {
  display: grid;
  min-height: 4.25rem;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.7rem;
  border: 1px solid var(--rule-soft);
  border-radius: 7px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
  cursor: pointer;
}

.inventory-action-destination:hover:not(.is-unavailable),
.inventory-action-destination:focus-within {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.inventory-action-destination.is-selected {
  border-color: var(--rt-focus);
  background: color-mix(in srgb, var(--rt-focus) 7%, var(--paper-soft));
}

.inventory-action-destination.is-unavailable { color: var(--ink-muted); cursor: not-allowed; }
.inventory-action-destination input { width: 1.15rem; height: 1.15rem; accent-color: var(--rt-focus); }
.inventory-action-destination__copy { display: grid; gap: 0.2rem; min-width: 0; }
.inventory-action-destination__copy strong { color: var(--ink-bright); }
.inventory-action-destination__copy small { color: var(--ink-muted); line-height: 1.35; }
.inventory-action-destination.is-unavailable .inventory-action-destination__copy small { color: var(--warn); }
.inventory-action-destination__state { color: var(--rt-focus); font-size: 0.74rem; font-weight: 800; text-transform: uppercase; }

.inventory-action-quantity {
  display: grid;
  grid-template-columns: 1fr 5.5rem;
  align-items: center;
  gap: 0.35rem 0.75rem;
  color: var(--ink-bright);
  font-weight: 700;
}
.inventory-action-quantity input {
  min-height: 2.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper-inset);
  color: var(--ink-bright);
  padding: 0.45rem 0.6rem;
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.inventory-action-quantity input:focus-visible {
  border-color: var(--rt-focus);
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}
.inventory-action-quantity small { grid-column: 1 / -1; color: var(--ink-muted); font-weight: 400; }

.inventory-action-consequences {
  border: 1px solid var(--rule-soft);
  border-radius: 7px;
  background: var(--paper-soft);
  padding: 0.75rem;
}
.inventory-action-consequences--danger {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.7rem;
  border-color: var(--rt-danger);
}
.inventory-action-consequences--danger > svg,
.inventory-action-consequences--danger strong { color: var(--rt-danger); }
.inventory-action-consequences strong { color: var(--ink-bright); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
.inventory-action-consequences ul { display: grid; gap: 0.3rem; margin: 0.45rem 0 0; padding-left: 1.1rem; color: var(--ink-soft); }
.inventory-action-confirmation {
  display: grid;
  min-height: 2.75rem;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  align-items: center;
  gap: 0.7rem;
  border: 1px solid var(--rt-danger);
  border-radius: 7px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
  color: var(--ink-bright);
  line-height: 1.45;
  cursor: pointer;
}
.inventory-action-confirmation:focus-within { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.inventory-action-confirmation input { width: 1.15rem; height: 1.15rem; accent-color: var(--rt-danger); }
.inventory-action-revision-note { margin: 0; color: var(--ink-muted); font-size: 0.78rem; line-height: 1.45; }

.inventory-action-decision__status {
  display: flex;
  min-height: 3.25rem;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--rt-focus);
  border-radius: 7px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
  color: var(--ink-soft);
}
.inventory-action-decision__status--accepted { border-left-color: var(--rt-success); color: var(--rt-success); }
.inventory-action-decision__status--uncertain,
.inventory-action-decision__status--conflict,
.inventory-action-decision__status--error { border-left-color: var(--rt-pending); }

.inventory-action-decision__footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.65rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.9rem;
}
.inventory-action-button {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper-soft);
  color: var(--ink-bright);
  padding: 0.55rem 0.85rem;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.inventory-action-button--primary { border-color: var(--rt-brand); background: var(--rt-brand); color: var(--rt-on-brand); }
.inventory-action-button--danger { border-color: var(--rt-danger); background: var(--rt-danger); color: var(--rt-on-brand); }
.inventory-action-button:hover:not(:disabled),
.inventory-action-button:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.inventory-action-button:disabled { border-color: var(--rule); background: var(--paper-inset); color: var(--ink-faint); cursor: not-allowed; }

@media (max-width: 560px) {
  .inventory-action-decision { padding: 0.85rem 0.75rem 0.85rem 0.95rem; }
  .inventory-action-destination { grid-template-columns: 1.25rem minmax(0, 1fr); }
  .inventory-action-destination__state { grid-column: 2; }
  .inventory-action-decision__footer { display: grid; grid-template-columns: 1fr; }
  .inventory-action-button { width: 100%; }
}
</style>
