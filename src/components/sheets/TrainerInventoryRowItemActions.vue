<script setup lang="ts">
import { computed } from 'vue'
import {
  PhArrowRight,
  PhArrowsMerge,
  PhArrowsSplit,
  PhClock,
  PhFloppyDisk,
  PhGift,
  PhMagnifyingGlass,
  PhPlay,
  PhTrash,
  PhTShirt,
} from '@phosphor-icons/vue'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'

const props = withDefaults(defineProps<{
  offer: SheetItemActionOfferV1 | null
  inventoryOffers?: readonly InventoryActionOfferV1[]
  selectedInventoryOfferId?: string | null
  canBegin: boolean
  busy: boolean
  resumeExtended?: boolean
  extendedBlocked?: boolean
  blockedReason?: string | null
}>(), {
  inventoryOffers: () => [],
  selectedInventoryOfferId: null,
  resumeExtended: false,
  extendedBlocked: false,
  blockedReason: null,
})

const emit = defineEmits<{
  use: [offer: SheetItemActionOfferV1]
  action: [offer: InventoryActionOfferV1]
  prepareIdentity: []
}>()

const inventoryOffer = (action: InventoryActionOfferV1['action']) => props.inventoryOffers.find(offer => offer.action === action) ?? null
const useOffer = computed(() => inventoryOffer('use'))
const legacyUseAction = computed(() => props.offer?.actions.find(action => action.kind === 'use') ?? null)
const legacyInspectAction = computed(() => props.offer?.actions.find(action => action.kind === 'inspect') ?? null)
const equipOffer = computed(() => inventoryOffer('equip'))
const giveOffer = computed(() => inventoryOffer('give'))
const transferOffer = computed(() => inventoryOffer('transfer'))
const splitOffer = computed(() => inventoryOffer('split'))
const mergeOffer = computed(() => inventoryOffer('merge'))
const discardOffer = computed(() => inventoryOffer('discard'))
const inspectOffer = computed(() => inventoryOffer('inspect'))
const reservationReason = computed(() => {
  const reasons = props.inventoryOffers
    .map(offer => offer.unavailableReason)
    .filter(reason => reason?.code.includes('reserved') || reason?.label.toLocaleLowerCase('en-US').includes('reserved'))
  return reasons[0]?.label ?? null
})
const canPrepareIdentity = computed(() => props.offer?.availability.unavailableReason?.code === 'source.identity-required'
  || props.inventoryOffers.some(offer => offer.unavailableReason?.code === 'source.identity-required'))
const treatmentItems = new Set(['First Aid Kit', 'Bandages'])
const extendedActionLabel = computed(() => treatmentItems.has(props.offer?.source.canonicalId ?? '')
  ? 'treatment'
  : 'Extended Action')
const recoveryBlocked = computed(() => props.blockedReason?.startsWith('Inventory actions are locked') ?? false)
const useDisabled = computed(() => !props.offer || !props.canBegin || props.busy
  || props.extendedBlocked || (!props.resumeExtended && !(useOffer.value?.enabled ?? legacyUseAction.value?.enabled)))
const useReason = computed(() => {
  if (!props.offer) return 'Checking current inventory actions…'
  if (!props.canBegin) return props.blockedReason ?? 'Finish saving the Trainer sheet before using an item.'
  if (props.extendedBlocked) return 'Finish or interrupt the current Extended Action before starting another one.'
  if (props.resumeExtended) return null
  return useOffer.value?.unavailableReason?.label
    ?? legacyUseAction.value?.unavailableReason?.label
    ?? props.offer.availability.unavailableReason?.label
    ?? null
})
const actionDisabled = (offer: InventoryActionOfferV1 | null): boolean => (
  !offer || !props.canBegin || props.busy || !offer.enabled
)
const actionTitle = (offer: InventoryActionOfferV1 | null, fallback: string): string => {
  if (!props.canBegin) return props.blockedReason ?? 'Finish saving the Trainer sheet before starting another inventory action.'
  return offer?.unavailableReason?.label ?? offer?.confirmation.label ?? fallback
}
const actionAccessibleLabel = (offer: InventoryActionOfferV1 | null, label: string, fallback: string): string => (
  actionDisabled(offer) ? `${label} unavailable: ${actionTitle(offer, fallback)}` : label
)
const beginUse = () => {
  if (!useDisabled.value && props.offer) emit('use', props.offer)
}
</script>

<template>
  <div class="inventory-item-actions">
    <div class="inventory-item-actions__controls" role="group" :aria-label="`${offer?.source.displayName ?? 'Item'} actions`">
      <button
        v-if="canPrepareIdentity"
        type="button"
        class="inventory-item-action inventory-item-action--prepare"
        :disabled="!canBegin || busy"
        title="Prepare this legacy row for authoritative inventory actions"
        :aria-label="!canBegin || busy
          ? `Prepare unavailable: ${blockedReason ?? 'Finish saving before preparing this row.'}`
          : 'Prepare'"
        @click="emit('prepareIdentity')"
      >
        <PhFloppyDisk :size="15" weight="bold" aria-hidden="true" />
        <span>Prepare</span>
      </button>

      <button
        v-if="useOffer || legacyUseAction || resumeExtended"
        type="button"
        class="inventory-item-action inventory-item-action--use"
        :disabled="useDisabled"
        :title="useReason ?? (resumeExtended ? `Resume current ${extendedActionLabel}` : 'Use this item')"
        :aria-label="useDisabled
          ? `Use unavailable: ${useReason ?? 'No current legal use is available.'}`
          : resumeExtended ? 'Resume' : 'Use'"
        @click="beginUse"
      >
        <PhClock v-if="resumeExtended" :size="15" weight="bold" aria-hidden="true" />
        <PhPlay v-else :size="15" weight="bold" aria-hidden="true" />
        <span>{{ resumeExtended ? 'Resume' : 'Use' }}</span>
      </button>

      <button
        v-if="equipOffer"
        type="button"
        class="inventory-item-action"
        :class="{ 'is-selected': equipOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="equipOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(equipOffer)"
        :title="actionTitle(equipOffer, 'Equip this whole item')"
        :aria-label="actionAccessibleLabel(equipOffer, 'Equip', 'Equip this whole item')"
        @click="emit('action', equipOffer)"
      >
        <PhTShirt :size="16" weight="bold" aria-hidden="true" />
        <span>Equip</span>
      </button>

      <button
        v-if="giveOffer"
        type="button"
        class="inventory-item-action"
        :class="{ 'is-selected': giveOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="giveOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(giveOffer)"
        :title="actionTitle(giveOffer, 'Give this whole item')"
        :aria-label="actionAccessibleLabel(giveOffer, 'Give', 'Give this whole item')"
        @click="emit('action', giveOffer)"
      >
        <PhGift :size="16" weight="bold" aria-hidden="true" />
        <span>Give</span>
      </button>

      <button
        v-if="transferOffer"
        type="button"
        class="inventory-item-action"
        :class="{ 'is-selected': transferOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="transferOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(transferOffer)"
        :title="actionTitle(transferOffer, 'Transfer this item')"
        :aria-label="actionAccessibleLabel(transferOffer, 'Transfer', 'Transfer this item')"
        @click="emit('action', transferOffer)"
      >
        <PhArrowRight :size="16" weight="bold" aria-hidden="true" />
        <span>Transfer</span>
      </button>

      <NuxtLink
        v-if="inspectOffer?.enabled && inspectOffer.execution.href"
        class="inventory-item-action inventory-item-action--inspect"
        :to="inspectOffer.execution.href"
      >
        <PhMagnifyingGlass :size="16" weight="bold" aria-hidden="true" />
        <span>Inspect</span>
      </NuxtLink>
      <NuxtLink
        v-else-if="legacyInspectAction?.enabled && legacyInspectAction.href"
        class="inventory-item-action inventory-item-action--inspect"
        :to="legacyInspectAction.href"
      >
        <PhMagnifyingGlass :size="16" weight="bold" aria-hidden="true" />
        <span>Inspect</span>
      </NuxtLink>
      <button
        v-else-if="inspectOffer || legacyInspectAction"
        type="button"
        class="inventory-item-action inventory-item-action--inspect"
        :title="inspectOffer?.unavailableReason?.label ?? legacyInspectAction?.unavailableReason?.label ?? 'No canonical item reference is available.'"
        :aria-label="`Inspect unavailable: ${inspectOffer?.unavailableReason?.label ?? legacyInspectAction?.unavailableReason?.label ?? 'No canonical item reference is available.'}`"
        disabled
      >
        <PhMagnifyingGlass :size="16" weight="bold" aria-hidden="true" />
        <span>Inspect</span>
      </button>
    </div>
    <div v-if="splitOffer || mergeOffer || discardOffer" class="inventory-item-actions__controls inventory-item-actions__controls--stack" role="group" :aria-label="`${offer?.source.displayName ?? 'Item'} stack actions`">
      <button
        v-if="splitOffer"
        type="button"
        class="inventory-item-action"
        :class="{ 'is-selected': splitOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="splitOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(splitOffer)"
        :title="actionTitle(splitOffer, 'Split this stack')"
        :aria-label="actionAccessibleLabel(splitOffer, 'Split', 'Split this stack')"
        @click="emit('action', splitOffer)"
      >
        <PhArrowsSplit :size="16" weight="bold" aria-hidden="true" />
        <span>Split</span>
      </button>
      <button
        v-if="mergeOffer"
        type="button"
        class="inventory-item-action"
        :class="{ 'is-selected': mergeOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="mergeOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(mergeOffer)"
        :title="actionTitle(mergeOffer, 'Merge this whole stack')"
        :aria-label="actionAccessibleLabel(mergeOffer, 'Merge', 'Merge this whole stack')"
        @click="emit('action', mergeOffer)"
      >
        <PhArrowsMerge :size="16" weight="bold" aria-hidden="true" />
        <span>Merge</span>
      </button>
      <button
        v-if="discardOffer"
        type="button"
        class="inventory-item-action inventory-item-action--discard"
        :class="{ 'is-selected': discardOffer.offerId === selectedInventoryOfferId }"
        :aria-pressed="discardOffer.offerId === selectedInventoryOfferId"
        :disabled="actionDisabled(discardOffer)"
        :title="actionTitle(discardOffer, 'Discard from this stack')"
        :aria-label="actionAccessibleLabel(discardOffer, 'Discard', 'Discard from this stack')"
        @click="emit('action', discardOffer)"
      >
        <PhTrash :size="16" weight="bold" aria-hidden="true" />
        <span>Discard</span>
      </button>
    </div>
    <p
      v-if="useReason && (!useOffer?.enabled || extendedBlocked)"
      class="inventory-item-actions__reason"
      :class="{ 'inventory-item-actions__reason--recovery': recoveryBlocked }"
    >
      {{ useReason }}
    </p>
    <p v-if="reservationReason && reservationReason !== useReason" class="inventory-item-actions__reason">
      Reserved: {{ reservationReason }}
    </p>
  </div>
</template>

<style scoped>
.inventory-item-actions {
  display: flex;
  min-width: 13rem;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
}
.inventory-item-actions__controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0; }
.inventory-item-actions__controls--stack .inventory-item-action { background: var(--paper-soft); color: var(--ink-muted); }
.inventory-item-action {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  border: 1px solid var(--rule-soft);
  border-right-width: 0;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.42rem 0.58rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}
.inventory-item-action:first-child { border-radius: 5px 0 0 5px; }
.inventory-item-action:last-child { border-right-width: 1px; border-radius: 0 5px 5px 0; }
.inventory-item-action:only-child { border-right-width: 1px; border-radius: 5px; }
.inventory-item-action:hover:not(:disabled),
.inventory-item-action:focus-visible,
.inventory-item-action.is-selected {
  position: relative;
  z-index: 1;
  border-color: var(--rt-focus);
  color: var(--ink-bright);
  outline: 2px solid var(--rt-focus);
  outline-offset: 1px;
}
.inventory-item-action--use:not(:disabled) { color: var(--rt-focus); }
.inventory-item-action--discard:not(:disabled).is-selected { color: var(--rt-danger); }
.inventory-item-action:disabled { border-color: var(--rule); background: var(--paper-inset); color: var(--ink-faint); cursor: not-allowed; }
.inventory-item-actions__reason { max-width: 18rem; margin: 0; color: var(--warn); font-size: 0.74rem; line-height: 1.35; text-align: right; white-space: normal; }

@media (max-width: 760px) {
  .inventory-item-actions,
  .inventory-item-actions__controls { width: 100%; min-width: 0; align-items: stretch; justify-content: flex-start; }
  .inventory-item-actions__controls { gap: 0.35rem; }
  .inventory-item-action,
  .inventory-item-action:first-child,
  .inventory-item-action:last-child { border: 1px solid var(--rule-soft); border-radius: 5px; }
  .inventory-item-actions__reason { text-align: left; }
  .inventory-item-actions__reason--recovery { display: none; }
}

@media (max-width: 560px) {
  .inventory-item-actions__controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .inventory-item-action { width: 100%; }
}
</style>
