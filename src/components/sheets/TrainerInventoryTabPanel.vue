<script setup lang="ts">
import { computed } from 'vue'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { TrainerSheetItemAcceptedResult } from '~/composables/sheets/useTrainerSheetItemActions'
import type { TrainerEquipmentAcceptedResult } from '~/composables/sheets/useTrainerEquipmentOperations'
import type { TrainerInventoryActionAcceptedResult } from '~/composables/sheets/useTrainerInventoryActionFlows'
import type { ItemGuidedAcceptedResult } from '~/composables/items/useItemGuidedAdjudication'
import type { InventoryContinuationAction } from '~/utils/inventoryContinuationRoute'
import { useInventoryHistory } from '~/composables/inventory/useInventoryHistory'

type InventoryKey = keyof NonNullable<TrainerSheet['inventory']>

const props = withDefaults(defineProps<{
  sheet: TrainerSheet
  saveStatus?: SaveStatus
  profileId?: string | null
  canAdjudicateEquipment?: boolean
  prepareItemAction?: () => Promise<void>
  reconcileInventoryAuthority?: () => Promise<void>
  inventoryContinuationAction?: InventoryContinuationAction | null
  inventoryContinuationSourceId?: string | null
}>(), {
  saveStatus: 'idle',
  profileId: null,
  canAdjudicateEquipment: false,
  prepareItemAction: undefined,
  reconcileInventoryAuthority: undefined,
  inventoryContinuationAction: null,
  inventoryContinuationSourceId: null,
})

const emit = defineEmits<{
  addItem: [key: InventoryKey]
  removeItem: [key: InventoryKey, index: number]
  itemAccepted: [response: TrainerSheetItemAcceptedResult | TrainerEquipmentAcceptedResult | TrainerInventoryActionAcceptedResult | ItemGuidedAcceptedResult]
}>()

const historyScope = computed(() => props.sheet.slug?.trim()
  ? { kind: 'trainer' as const, slug: props.sheet.slug.trim() }
  : null)
const historyProfileId = computed(() => props.profileId)
const inventoryHistory = useInventoryHistory({
  scope: historyScope,
  profileId: historyProfileId,
})

const forwardAddItem = (key: InventoryKey) => emit('addItem', key)
const forwardRemoveItem = (key: InventoryKey, index: number) => emit('removeItem', key, index)
const forwardAccepted = (
  response: TrainerSheetItemAcceptedResult | TrainerEquipmentAcceptedResult | TrainerInventoryActionAcceptedResult | ItemGuidedAcceptedResult,
) => {
  emit('itemAccepted', response)
  void inventoryHistory.refresh()
}
</script>

<template>
  <section class="tab-panel">
    <TrainerInventoryPanel
      :sheet="sheet"
      :save-status="saveStatus"
      :profile-id="profileId"
      :can-adjudicate-equipment="canAdjudicateEquipment"
      :prepare-item-action="prepareItemAction"
      :reconcile-inventory-authority="reconcileInventoryAuthority"
      :inventory-continuation-action="inventoryContinuationAction"
      :inventory-continuation-source-id="inventoryContinuationSourceId"
      :inventory-history="inventoryHistory.projection.value"
      :inventory-history-status="inventoryHistory.status.value"
      :inventory-history-error="inventoryHistory.error.value"
      @add-item="forwardAddItem"
      @remove-item="forwardRemoveItem"
      @item-accepted="forwardAccepted"
      @refresh-inventory-history="inventoryHistory.refresh"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
