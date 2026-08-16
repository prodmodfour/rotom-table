<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import { useTrainerSheetItemActions, type TrainerSheetItemAcceptedResult } from '~/composables/sheets/useTrainerSheetItemActions'
import { useTrainerItemExtendedActions } from '~/composables/sheets/useTrainerItemExtendedActions'
import { useTrainerItemExploration } from '~/composables/sheets/useTrainerItemExploration'
import {
  useTrainerInventoryActionFlows,
  type TrainerInventoryActionAcceptedResult,
} from '~/composables/sheets/useTrainerInventoryActionFlows'
import {
  useTrainerEquipmentOperations,
  type TrainerEquipmentAcceptedResult,
} from '~/composables/sheets/useTrainerEquipmentOperations'
import { createInventoryTransferRowId } from '~/utils/groupInventoryTransfers'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { ItemGuidedAcceptedResult } from '~/composables/items/useItemGuidedAdjudication'
import type { InventoryContinuationAction } from '~/utils/inventoryContinuationRoute'
import type { InventoryHistoryProjectionV1 } from '#shared/itemAutomation/inventoryHistory'
import type { InventoryHistoryLoadStatus } from '~/composables/inventory/useInventoryHistory'

const props = withDefaults(defineProps<{
  sheet: TrainerSheet
  saveStatus?: SaveStatus
  profileId?: string | null
  canAdjudicateEquipment?: boolean
  prepareItemAction?: () => Promise<void>
  reconcileInventoryAuthority?: () => Promise<void>
  inventoryContinuationAction?: InventoryContinuationAction | null
  inventoryContinuationSourceId?: string | null
  inventoryHistory?: InventoryHistoryProjectionV1 | null
  inventoryHistoryStatus?: InventoryHistoryLoadStatus
  inventoryHistoryError?: string | null
}>(), {
  saveStatus: 'idle',
  profileId: null,
  canAdjudicateEquipment: false,
  prepareItemAction: undefined,
  reconcileInventoryAuthority: undefined,
  inventoryContinuationAction: null,
  inventoryContinuationSourceId: null,
  inventoryHistory: null,
  inventoryHistoryStatus: 'idle',
  inventoryHistoryError: null,
})

const emit = defineEmits<{
  addItem: [key: TrainerInventoryKey]
  removeItem: [key: TrainerInventoryKey, index: number]
  itemAccepted: [response: TrainerSheetItemAcceptedResult | TrainerEquipmentAcceptedResult | TrainerInventoryActionAcceptedResult | ItemGuidedAcceptedResult]
  refreshInventoryHistory: []
}>()

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((section) => section.key === activeSectionKey.value)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))
const inventorySectionCounts = computed<Partial<Record<TrainerInventoryKey, number>>>(() => {
  const inventory = props.sheet.inventory
  return TRAINER_INVENTORY_SECTIONS.reduce<Partial<Record<TrainerInventoryKey, number>>>((counts, section) => {
    counts[section.key] = inventory?.[section.key]?.length ?? 0
    return counts
  }, {})
})

const extendedActionCoordinator = useTrainerItemExtendedActions({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  profileId: () => props.profileId,
  prepareForAction: async () => { await props.prepareItemAction?.() },
  onAccepted: async response => emit('itemAccepted', response),
})
const actionCoordinator = useTrainerSheetItemActions({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  profileId: () => props.profileId,
  prepareForAction: async () => { await props.prepareItemAction?.() },
  reconcileAuthority: async () => { await props.reconcileInventoryAuthority?.() },
  onStartExtendedAction: extendedActionCoordinator.start,
  onAccepted: async response => emit('itemAccepted', response),
})
const explorationCoordinator = useTrainerItemExploration({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  profileId: () => props.profileId,
  prepareForAction: async () => { await props.prepareItemAction?.() },
})
const equipmentCoordinator = useTrainerEquipmentOperations({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  profileId: () => props.profileId,
  canAdjudicateLifecycle: () => props.canAdjudicateEquipment,
  prepareForAction: async () => { await props.prepareItemAction?.() },
  reconcileAuthority: async () => { await props.reconcileInventoryAuthority?.() },
  onAccepted: async response => emit('itemAccepted', response),
})
const inventoryActionCoordinator = useTrainerInventoryActionFlows({
  sheet: () => props.sheet,
  saveStatus: () => props.saveStatus,
  profileId: () => props.profileId,
  prepareForAction: async () => { await props.prepareItemAction?.() },
  reconcileAuthority: async () => { await props.reconcileInventoryAuthority?.() },
  onAccepted: async response => emit('itemAccepted', response),
})
const equipmentRecoveryState = computed<'uncertain' | 'conflict' | 'error' | null>(() => (
  equipmentCoordinator.status.value === 'uncertain'
    || equipmentCoordinator.status.value === 'conflict'
    || equipmentCoordinator.status.value === 'error'
    ? equipmentCoordinator.status.value : null
))
const showTreatment = computed(() => Boolean(extendedActionCoordinator.activeActivity.value)
  || ['uncertain', 'completed', 'interrupted', 'conflict', 'error'].includes(extendedActionCoordinator.status.value))
const showExploration = computed(() => Boolean(explorationCoordinator.authority.value)
  && (explorationCoordinator.hasActivity.value
    || ['uncertain', 'accepted', 'conflict', 'error'].includes(explorationCoordinator.status.value)))
const showInventoryActionDecision = computed(() => Boolean(inventoryActionCoordinator.selectedOffer.value)
  || ['uncertain', 'accepted', 'conflict', 'error'].includes(inventoryActionCoordinator.status.value))
const showDecision = computed(() => showTreatment.value || Boolean(actionCoordinator.selectedOffer.value)
  || ['uncertain', 'pending-gm', 'accepted', 'conflict', 'error'].includes(actionCoordinator.status.value)
  || showInventoryActionDecision.value || showExploration.value)
const anyActionBusy = computed(() => actionCoordinator.busy.value
  || extendedActionCoordinator.busy.value || equipmentCoordinator.busy.value
  || explorationCoordinator.busy.value || inventoryActionCoordinator.busy.value)
const canBeginAnyAction = computed(() => actionCoordinator.canBegin.value
  && equipmentCoordinator.canBegin.value && inventoryActionCoordinator.canBegin.value
  && !['uncertain', 'conflict', 'error'].includes(extendedActionCoordinator.status.value)
  && !['uncertain', 'conflict', 'error'].includes(explorationCoordinator.status.value))
const inventoryRecoveryRequired = computed(() => [
  actionCoordinator.status.value,
  equipmentCoordinator.status.value,
  inventoryActionCoordinator.status.value,
  extendedActionCoordinator.status.value,
  explorationCoordinator.status.value,
].some(current => ['uncertain', 'conflict', 'error'].includes(current)))
const inventoryMutationBlockedReason = computed(() => {
  if (inventoryRecoveryRequired.value) {
    return 'Inventory actions are locked until the retained result is retried or authoritative inventory is reloaded.'
  }
  if (!['idle', 'saved'].includes(props.saveStatus)) return 'Finish saving the Trainer sheet before starting another inventory action.'
  if (anyActionBusy.value) return 'Wait for the current inventory request to finish before starting another action.'
  return 'Finish the current inventory decision before starting another action.'
})
const selectedSourceRowIndex = computed(() => {
  if (actionCoordinator.selectedOffer.value?.source.section === activeSection.value.key) {
    return actionCoordinator.selectedOffer.value.source.rowIndex
  }
  const sourceSelectionId = inventoryActionCoordinator.selectedOffer.value?.source.sourceSelectionId
  const sourceOffer = sourceSelectionId
    ? actionCoordinator.projection.value?.offers.find(offer => offer.source.sourceSelectionId === sourceSelectionId)
    : null
  return sourceOffer?.source.section === activeSection.value.key ? sourceOffer.source.rowIndex : null
})
const selectedLifecycleInstanceId = ref<string | null>(null)
const selectedLifecycleInstance = computed(() => props.sheet.equipmentState?.instances
  .find(instance => instance.instanceId === selectedLifecycleInstanceId.value) ?? null)
const sectionTabs = ref<{ focusActive: () => void } | null>(null)
const treatmentCard = ref<{ focus: () => void } | null>(null)
const equipmentStatus = ref<HTMLElement | null>(null)
let actionOrigin: HTMLElement | null = null
let equipmentOrigin: HTMLElement | null = null
let lifecycleOrigin: HTMLElement | null = null

const currentFocusOrigin = (): HTMLElement | null => {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}
const forwardAddItem = (key: TrainerInventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: TrainerInventoryKey, index: number) => emit('removeItem', key, index)
const resumesActiveTreatment = (offer: SheetItemActionOfferV1 | null): boolean => Boolean(
  offer?.timingLabel === 'Extended Action'
  && extendedActionCoordinator.activeActivity.value?.item.canonicalId === offer.source.canonicalId,
)
const blockedByActiveTreatment = (offer: SheetItemActionOfferV1 | null): boolean => Boolean(
  offer?.timingLabel === 'Extended Action'
  && extendedActionCoordinator.activeActivity.value
  && !resumesActiveTreatment(offer),
)
const beginUse = (offer: SheetItemActionOfferV1) => {
  actionOrigin = currentFocusOrigin()
  inventoryActionCoordinator.close()
  if (resumesActiveTreatment(offer)) {
    void nextTick(() => treatmentCard.value?.focus())
    return
  }
  actionCoordinator.openOffer(offer)
}
const beginInventoryAction = (offer: InventoryActionOfferV1) => {
  actionOrigin = currentFocusOrigin()
  actionCoordinator.closeDecision()
  inventoryActionCoordinator.open(offer)
}
const beginUnequip = (instanceId: string) => {
  equipmentOrigin = currentFocusOrigin()
  void equipmentCoordinator.unequip(instanceId)
}
const restoreEquipmentFocus = async (): Promise<void> => {
  await nextTick()
  if (equipmentOrigin?.isConnected) equipmentOrigin.focus()
  else sectionTabs.value?.focusActive()
  equipmentOrigin = null
}
const dismissEquipmentStatus = async (): Promise<void> => {
  equipmentCoordinator.dismiss()
  await restoreEquipmentFocus()
}
const reconcileEquipment = async (): Promise<void> => {
  await equipmentCoordinator.reconcile()
  if (!equipmentRecoveryState.value && equipmentCoordinator.status.value !== 'accepted') await restoreEquipmentFocus()
}
const openLifecycle = (instanceId: string) => {
  lifecycleOrigin = currentFocusOrigin()
  selectedLifecycleInstanceId.value = instanceId
}
const closeLifecycle = async () => {
  selectedLifecycleInstanceId.value = null
  await nextTick()
  lifecycleOrigin?.focus()
  lifecycleOrigin = null
}
const prepareRowIdentity = (rowIndex: number) => {
  const rows = props.sheet.inventory?.[activeSection.value.key]
  const entry = rows?.[rowIndex]
  if (!rows || !entry || entry.id?.trim()) return
  const existing = new Set(rows.map(row => row.id).filter((value): value is string => Boolean(value)))
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createInventoryTransferRowId({
      section: activeSection.value.key,
      index: rowIndex + attempt,
      sourceEntry: entry,
    })
    if (!existing.has(id)) {
      entry.id = id
      return
    }
  }
  throw new Error('Could not allocate a unique item row identity.')
}
const restoreActionFocus = async (): Promise<void> => {
  await nextTick()
  if (actionOrigin?.isConnected) actionOrigin.focus()
  else sectionTabs.value?.focusActive()
  actionOrigin = null
}
const cancelDecision = async () => {
  actionCoordinator.closeDecision()
  await restoreActionFocus()
}
const refreshItemDecision = async () => {
  await actionCoordinator.refresh()
  if (!['uncertain', 'conflict', 'error'].includes(actionCoordinator.status.value)) await restoreActionFocus()
}
const cancelInventoryAction = async () => {
  if (inventoryActionCoordinator.status.value === 'accepted') inventoryActionCoordinator.dismiss()
  else inventoryActionCoordinator.close()
  await restoreActionFocus()
}
const refreshInventoryAction = async () => {
  await inventoryActionCoordinator.refresh()
  if (!['uncertain', 'conflict', 'error'].includes(inventoryActionCoordinator.status.value)) await restoreActionFocus()
}
const refreshTreatment = async (): Promise<void> => {
  await extendedActionCoordinator.refresh()
  if (!showTreatment.value) await restoreActionFocus()
}
const dismissTreatment = async () => {
  extendedActionCoordinator.dismiss()
  await restoreActionFocus()
}
const refreshExploration = async (): Promise<void> => {
  await explorationCoordinator.load()
  if (!showExploration.value) await restoreActionFocus()
}
const dismissExploration = async (): Promise<void> => {
  explorationCoordinator.dismiss()
  await restoreActionFocus()
}
let handledContinuationSignature: string | null = null
watch(
  [
    () => props.inventoryContinuationAction,
    () => props.inventoryContinuationSourceId,
    () => actionCoordinator.projection.value?.generatedAt ?? null,
    () => inventoryActionCoordinator.projection.value?.generatedAt ?? null,
    canBeginAnyAction,
  ],
  async ([action, sourceSelectionId]) => {
    const signature = action && sourceSelectionId ? `${action}:${sourceSelectionId}` : null
    if (!signature || handledContinuationSignature === signature || !canBeginAnyAction.value) return
    const inventoryOffer = inventoryActionCoordinator.projection.value?.offers.find(offer => (
      offer.action === action && offer.source.sourceSelectionId === sourceSelectionId && offer.enabled
    ))
    if (!inventoryOffer?.source.section) return
    activeSectionKey.value = inventoryOffer.source.section
    await nextTick()
    if (action === 'use') {
      const itemOffer = actionCoordinator.projection.value?.offers.find(offer => (
        offer.source.sourceSelectionId === sourceSelectionId
      ))
      if (!itemOffer) return
      handledContinuationSignature = signature
      beginUse(itemOffer)
      return
    }
    handledContinuationSignature = signature
    beginInventoryAction(inventoryOffer)
  },
  { immediate: true },
)
watch(selectedLifecycleInstance, (instance) => {
  if (!instance && selectedLifecycleInstanceId.value) selectedLifecycleInstanceId.value = null
})
watch(() => equipmentCoordinator.status.value, async (current, previous) => {
  if (current !== 'accepted' || previous === 'accepted') return
  await nextTick()
  equipmentStatus.value?.focus()
})
</script>

<template>
  <div class="trainer-inventory-panel">
    <div
      class="equipment-effective-workspace"
      :class="{ 'equipment-effective-workspace--adjudicating': selectedLifecycleInstance }"
    >
      <TrainerEquippedGearPanel
        :equipment-slots="sheet.equipmentSlots!"
        :equipment-state="sheet.equipmentState"
        :equipment-projection="sheet.equipmentProjection"
        :can-manage="equipmentCoordinator.canBegin.value"
        :can-adjudicate="canAdjudicateEquipment && Boolean(sheet.equipmentState)"
        :selected-instance-id="selectedLifecycleInstanceId"
        :busy="equipmentCoordinator.busy.value"
        @unequip="beginUnequip"
        @review="openLifecycle"
      />
      <EquipmentLifecycleAdjudicator
        v-if="selectedLifecycleInstance"
        :instance="selectedLifecycleInstance"
        :busy="equipmentCoordinator.busy.value"
        @cancel="closeLifecycle"
        @submit="equipmentCoordinator.adjudicateLifecycle"
      />
      <EquipmentContributionInspector
        v-if="sheet.equipmentContributionProjection"
        class="equipment-contribution-workspace"
        :projection="sheet.equipmentContributionProjection"
      />
    </div>

    <TrainerGuidedItemPanel
      :sheet="sheet"
      :profile-id="profileId"
      :enabled="canBeginAnyAction"
      @accepted="emit('itemAccepted', $event)"
    />

    <InventoryRecoveryCard
      v-if="equipmentRecoveryState"
      :state="equipmentRecoveryState"
      :message="equipmentCoordinator.message.value"
      :online="equipmentCoordinator.online.value"
      :busy="equipmentCoordinator.busy.value"
      :exact-retry-available="equipmentCoordinator.exactRetryAvailable.value"
      retry-label="Retry exact equipment command"
      @retry-exact="equipmentCoordinator.retryExact"
      @reconcile="reconcileEquipment"
    />
    <div
      v-else-if="equipmentCoordinator.message.value"
      ref="equipmentStatus"
      class="equipment-operation-status"
      :class="`equipment-operation-status--${equipmentCoordinator.status.value}`"
      role="status"
      aria-live="polite"
      tabindex="-1"
    >
      <span>{{ equipmentCoordinator.message.value }}</span>
      <button
        v-if="!equipmentCoordinator.busy.value"
        type="button"
        @click="dismissEquipmentStatus"
      >
        Dismiss
      </button>
    </div>

    <div
      class="inventory-receipts-workspace"
      :class="{ 'inventory-receipts-workspace--decision': showDecision }"
    >
      <div class="inventory-primary-workspace">
        <InventorySectionTabs
          ref="sectionTabs"
          v-model:active-section-key="activeSectionKey"
          :counts="inventorySectionCounts"
          id-prefix="trainer-inventory"
          panel-id="trainer-inventory-section-panel"
        />

        <div class="inventory-action-workspace" :class="{ 'has-decision': showDecision }">
          <div
            id="trainer-inventory-section-panel"
            class="inventory-section-panel"
            role="tabpanel"
            :aria-labelledby="`trainer-inventory-tab-${activeSection.key}`"
          >
        <TrainerInventoryItemTable
          :key="activeSection.key"
          :section-key="activeSection.key"
          :title="activeSection.title"
          :items="sheet.inventory![activeSection.key]"
          :name-placeholder="activeSection.namePlaceholder"
          :variant="activeSection.variant"
          :selected-row-index="selectedSourceRowIndex"
          @add-item="forwardAddItem"
          @remove-item="forwardRemoveItem"
        >
          <template #rowActions="{ index }">
            <TrainerInventoryRowItemActions
              :offer="actionCoordinator.offerForRow(activeSection.key, index)"
              :inventory-offers="inventoryActionCoordinator.offersForSource(
                actionCoordinator.offerForRow(activeSection.key, index)?.source.sourceSelectionId,
              )"
              :selected-inventory-offer-id="inventoryActionCoordinator.selectedOffer.value?.offerId"
              :can-begin="canBeginAnyAction"
              :busy="anyActionBusy"
              :blocked-reason="inventoryMutationBlockedReason"
              :resume-extended="resumesActiveTreatment(actionCoordinator.offerForRow(activeSection.key, index))"
              :extended-blocked="blockedByActiveTreatment(actionCoordinator.offerForRow(activeSection.key, index))"
              @use="beginUse"
              @action="beginInventoryAction"
              @prepare-identity="prepareRowIdentity(index)"
            />
          </template>
        </TrainerInventoryItemTable>
      </div>

      <TrainerItemExtendedActionCard
        v-if="showTreatment"
        ref="treatmentCard"
        :activity="extendedActionCoordinator.latestActivity.value"
        :status="extendedActionCoordinator.status.value"
        :message="extendedActionCoordinator.message.value"
        :busy="extendedActionCoordinator.busy.value"
        :recovery-online="extendedActionCoordinator.online.value"
        :exact-retry-available="extendedActionCoordinator.exactRetryAvailable.value"
        @complete="extendedActionCoordinator.complete"
        @interrupt="extendedActionCoordinator.interrupt"
        @retry-exact="extendedActionCoordinator.retryExact"
        @refresh="refreshTreatment"
        @dismiss="dismissTreatment"
      />

      <TrainerSheetItemDecision
        v-else-if="Boolean(actionCoordinator.selectedOffer.value)
          || ['uncertain', 'pending-gm', 'accepted', 'conflict', 'error'].includes(actionCoordinator.status.value)"
        :offer="actionCoordinator.selectedOffer.value"
        :source-selection="actionCoordinator.sourceSelection.value"
        :selected-target-ids="actionCoordinator.selectedTargetIds.value"
        :selected-choices="actionCoordinator.selectedChoices.value"
        :status="actionCoordinator.status.value"
        :message="actionCoordinator.message.value"
        :accepted-sheet-links="actionCoordinator.acceptedSheetLinks.value"
        :busy="actionCoordinator.busy.value"
        :recovery-online="actionCoordinator.online.value"
        :exact-retry-available="actionCoordinator.exactRetryAvailable.value"
        @choose-source="actionCoordinator.chooseSource"
        @choose-target="actionCoordinator.chooseTarget"
        @choose-option="actionCoordinator.chooseOption"
        @confirm="actionCoordinator.submit"
        @cancel="cancelDecision"
        @retry-exact="actionCoordinator.retryExact"
        @refresh="refreshItemDecision"
      />

      <InventoryActionDecision
        v-else-if="showInventoryActionDecision"
        :offer="inventoryActionCoordinator.selectedOffer.value"
        :selected-destination-id="inventoryActionCoordinator.selectedDestinationId.value"
        :quantity="inventoryActionCoordinator.selectedQuantity.value"
        :selected-confirmation-option-id="inventoryActionCoordinator.selectedConfirmationOptionId.value"
        :status="inventoryActionCoordinator.status.value"
        :message="inventoryActionCoordinator.message.value"
        :busy="inventoryActionCoordinator.busy.value"
        :recovery-online="inventoryActionCoordinator.online.value"
        :exact-retry-available="inventoryActionCoordinator.exactRetryAvailable.value"
        @choose-destination="inventoryActionCoordinator.chooseDestination"
        @set-quantity="inventoryActionCoordinator.setQuantity"
        @set-confirmation="inventoryActionCoordinator.setConfirmation"
        @confirm="inventoryActionCoordinator.submit"
        @cancel="cancelInventoryAction"
        @retry-exact="inventoryActionCoordinator.retryExact"
        @refresh="refreshInventoryAction"
        @dismiss="cancelInventoryAction"
      />

          <TrainerExplorationActivityCard
            v-else-if="showExploration && explorationCoordinator.authority.value && explorationCoordinator.projection.value"
            :authority="explorationCoordinator.authority.value"
            :projection="explorationCoordinator.projection.value"
            :status="explorationCoordinator.status.value"
            :message="explorationCoordinator.message.value"
            :busy="explorationCoordinator.busy.value"
            :recovery-online="explorationCoordinator.online.value"
            :exact-retry-available="explorationCoordinator.exactRetryAvailable.value"
            @resolve-check="explorationCoordinator.resolveCheck"
            @cancel-lure="explorationCoordinator.settle('cancelled')"
            @settle-encounter="explorationCoordinator.settle('encounter-introduced', $event)"
            @adjudicate-loss="explorationCoordinator.settle('lure-lost')"
            @retry-exact="explorationCoordinator.retryExact"
            @refresh="refreshExploration"
            @dismiss="dismissExploration"
          />
        </div>
      </div>

      <InventoryHistoryPanel
        :projection="inventoryHistory"
        :status="inventoryHistoryStatus"
        :error="inventoryHistoryError"
        @refresh="emit('refreshInventoryHistory')"
      />
    </div>
  </div>
</template>

<style scoped>
.trainer-inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.equipment-effective-workspace {
  display: grid;
  grid-template-columns: minmax(18rem, 0.9fr) minmax(22rem, 1.1fr);
  align-items: start;
  gap: 0.85rem;
}

.equipment-effective-workspace--adjudicating {
  grid-template-columns: minmax(20rem, 0.85fr) minmax(24rem, 1.15fr);
}

.equipment-effective-workspace--adjudicating .equipment-contribution-workspace {
  grid-column: 1 / -1;
}

.equipment-operation-status {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: var(--paper-soft);
  padding: 0.55rem 0.7rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.equipment-operation-status--conflict,
.equipment-operation-status--error,
.equipment-operation-status--uncertain {
  border-left-color: var(--warn);
}

.equipment-operation-status:focus-visible {
  outline: 2px solid var(--rt-focus);
  outline-offset: 2px;
}

.equipment-operation-status button {
  min-height: 2.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.inventory-receipts-workspace {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 3fr) minmax(19rem, 2fr);
  align-items: start;
  gap: 1rem;
}

.inventory-receipts-workspace--decision {
  grid-template-columns: minmax(0, 1fr);
}

.inventory-primary-workspace {
  display: grid;
  min-width: 0;
  gap: 0.85rem;
}

.inventory-action-workspace {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.inventory-action-workspace.has-decision {
  grid-template-columns: minmax(34rem, 1.4fr) minmax(20rem, 0.85fr);
}

.inventory-section-panel {
  min-width: 0;
  overflow-x: auto;
}

@media (max-width: 1200px) {
  .inventory-receipts-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .inventory-action-workspace.has-decision {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .equipment-effective-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .inventory-section-panel { overflow: visible; }
}
</style>
