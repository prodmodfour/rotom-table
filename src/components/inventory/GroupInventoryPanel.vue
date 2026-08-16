<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { GroupInventoryItemActorOptionV1 } from '#shared/itemAutomation/groupInventoryItemActions'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { InventoryActionFlowStatus } from '~/composables/sheets/useTrainerInventoryActionFlows'
import type { TrainerSheetItemActionStatus } from '~/composables/sheets/useTrainerSheetItemActions'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import InventoryActionDecision from '~/components/inventory/InventoryActionDecision.vue'
import TrainerSheetItemDecision from '~/components/sheets/TrainerSheetItemDecision.vue'
import {
  createGroupInventoryRowId,
  type GroupInventoryDocument,
  type GroupInventoryEntry,
} from '~/types/groupInventory'
import type { InventoryEntry } from '~/types/trainerSheet'
import {
  setTrainerInventoryItemName,
  trainerInventoryItemOptions,
} from '~/utils/sheets/trainerInventoryItems'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { GroupInventorySaveStatus } from '~/composables/useGroupInventoryEditor'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'
import type { InventoryHistoryProjectionV1 } from '#shared/itemAutomation/inventoryHistory'
import type { InventoryHistoryLoadStatus } from '~/composables/inventory/useInventoryHistory'

const props = withDefaults(defineProps<{
  document: GroupInventoryDocument
  canEdit?: boolean
  isDirty?: boolean
  saveStatus?: GroupInventorySaveStatus
  saveError?: string | null
  actionOffers?: readonly InventoryActionOfferV1[]
  selectedActionOffer?: InventoryActionOfferV1 | null
  selectedDestinationId?: string | null
  selectedQuantity?: number
  selectedConfirmationOptionId?: string | null
  actionStatus?: InventoryActionFlowStatus
  actionMessage?: string | null
  actionBusy?: boolean
  actionRecoveryOnline?: boolean
  actionExactRetryAvailable?: boolean
  actionCanBegin?: boolean
  actionUnavailableReason?: string | null
  itemActors?: readonly GroupInventoryItemActorOptionV1[]
  selectedItemActorId?: string | null
  itemActionOffers?: readonly SheetItemActionOfferV1[]
  selectedItemOffer?: SheetItemActionOfferV1 | null
  itemSelectedTargetIds?: readonly string[]
  itemSelectedChoices?: Readonly<Record<string, readonly string[]>>
  itemStatus?: TrainerSheetItemActionStatus
  itemMessage?: string | null
  itemAcceptedSheetLinks?: readonly { readonly href: string, readonly label: string }[]
  itemBusy?: boolean
  itemRecoveryOnline?: boolean
  itemExactRetryAvailable?: boolean
  itemCanBegin?: boolean
  itemUnavailableReason?: string | null
  inventoryHistory?: InventoryHistoryProjectionV1 | null
  inventoryHistoryStatus?: InventoryHistoryLoadStatus
  inventoryHistoryError?: string | null
}>(), {
  canEdit: false,
  isDirty: false,
  saveStatus: 'idle',
  saveError: null,
  actionOffers: () => [],
  selectedActionOffer: null,
  selectedDestinationId: null,
  selectedQuantity: 1,
  selectedConfirmationOptionId: null,
  actionStatus: 'idle',
  actionMessage: null,
  actionBusy: false,
  actionRecoveryOnline: true,
  actionExactRetryAvailable: true,
  actionCanBegin: false,
  actionUnavailableReason: null,
  itemActors: () => [],
  selectedItemActorId: null,
  itemActionOffers: () => [],
  selectedItemOffer: null,
  itemSelectedTargetIds: () => [],
  itemSelectedChoices: () => ({}),
  itemStatus: 'idle',
  itemMessage: null,
  itemAcceptedSheetLinks: () => [],
  itemBusy: false,
  itemRecoveryOnline: true,
  itemExactRetryAvailable: true,
  itemCanBegin: false,
  itemUnavailableReason: null,
  inventoryHistory: null,
  inventoryHistoryStatus: 'idle',
  inventoryHistoryError: null,
})

const emit = defineEmits<{
  save: []
  reloadAfterConflict: []
  refreshActions: []
  openAction: [offer: InventoryActionOfferV1]
  chooseDestination: [destinationId: string]
  setQuantity: [quantity: number]
  setConfirmation: [accepted: boolean]
  confirmAction: []
  cancelAction: []
  retryExact: []
  dismissAction: []
  chooseItemActor: [actorSelectionId: string]
  openItemUse: [offer: SheetItemActionOfferV1]
  chooseItemTarget: [targetId: string]
  chooseItemOption: [choiceId: string, optionId: string]
  confirmItemUse: []
  cancelItemUse: []
  retryExactItemUse: []
  refreshItemUses: []
  refreshInventoryHistory: []
}>()

const groupStackActions = ['split', 'merge', 'discard'] as const

type TransferWorkspaceState = {
  readonly direction: 'group-to-trainer' | 'trainer-to-group' | 'group-stack' | 'group-use'
  readonly sectionKey: TrainerInventoryKey
  readonly groupRowIndex?: number
}

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const sectionTabs = ref<{ focusActive: () => void } | null>(null)
const transferWorkspace = ref<TransferWorkspaceState | null>(null)
let workspaceOrigin: HTMLElement | null = null
let synchronizingSelectedWorkspace = false
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find(section => section.key === activeSectionKey.value)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))
const inventorySectionCounts = computed<Partial<Record<TrainerInventoryKey, number>>>(() => (
  TRAINER_INVENTORY_SECTIONS.reduce<Partial<Record<TrainerInventoryKey, number>>>((counts, section) => {
    counts[section.key] = props.document.inventory[section.key]?.length ?? 0
    return counts
  }, {})
))
const activeSectionItems = computed(() => props.document.inventory[activeSection.value.key] ?? [])
const totalItemRows = computed(() => (
  TRAINER_INVENTORY_SECTIONS.reduce((total, section) => total + (props.document.inventory[section.key]?.length ?? 0), 0)
))
const isInventoryEmpty = computed(() => totalItemRows.value === 0)
const moneyDisplay = computed(() => `$${props.document.money.toLocaleString('en-US')}`)
const notes = computed(() => props.document.notes?.trim() ?? '')
const itemNameOptions = computed(() => trainerInventoryItemOptions(activeSection.value.key))
const canSubmitSave = computed(() => props.canEdit && props.isDirty && props.saveStatus !== 'saving')
const saveButtonLabel = computed(() => {
  if (props.saveStatus === 'saving') return 'Saving…'
  return props.isDirty ? 'Save inventory' : 'No changes to save'
})
const saveStatusMessage = computed(() => {
  if (props.saveStatus === 'saving') return 'Saving shared inventory…'
  if (props.saveStatus === 'saved') return `Saved shared inventory at revision ${props.document.revision}.`
  if (props.saveStatus === 'conflict') return props.saveError ?? 'The shared inventory changed elsewhere. Reload before saving again.'
  if (props.saveStatus === 'error') return props.saveError ?? 'The shared inventory could not be saved.'
  return null
})
const saveStatusRole = computed(() => (props.saveStatus === 'conflict' || props.saveStatus === 'error' ? 'alert' : 'status'))

const sectionActionOffers = (section: TrainerInventoryKey, direction: TransferWorkspaceState['direction']) => (
  props.actionOffers.filter(offer => (
    offer.action === 'transfer'
    && offer.source.section === section
    && offer.source.locationKind === (direction === 'group-to-trainer' ? 'group-inventory' : 'trainer-inventory')
  ))
)
const activeReceiveOffers = computed(() => sectionActionOffers(activeSection.value.key, 'trainer-to-group'))
const canReceiveFromTrainer = computed(() => (
  props.actionCanBegin && activeReceiveOffers.value.some(offer => offer.enabled)
))
const showItemUseControls = computed(() => (
  props.itemActors.length > 0 || props.itemActionOffers.length > 0
  || props.itemStatus !== 'idle' || Boolean(props.itemUnavailableReason)
))
const showTransferControls = computed(() => (
  props.actionOffers.length > 0
  || props.actionStatus !== 'idle'
  || Boolean(props.actionUnavailableReason)
  || showItemUseControls.value
))
const actionRecovery = computed(() => ['uncertain', 'conflict', 'error'].includes(props.actionStatus))
const itemRecovery = computed(() => ['uncertain', 'conflict', 'error'].includes(props.itemStatus))
const hasDecisionWorkspace = computed(() => Boolean(transferWorkspace.value) || actionRecovery.value || itemRecovery.value)
const activeWorkspaceDirection = computed<TransferWorkspaceState['direction']>(() => (
  transferWorkspace.value?.direction ?? (itemRecovery.value ? 'group-use' : 'group-stack')
))
const actionStatusMessage = computed(() => {
  if (props.actionStatus === 'loading') return 'Loading exact server-issued inventory actions…'
  if (props.actionStatus === 'submitting') return props.actionMessage ?? 'Rechecking exact inventory authority…'
  if (props.actionStatus === 'accepted') return props.actionMessage
  if (['conflict', 'error', 'uncertain'].includes(props.actionStatus)) return props.actionMessage
  if (props.actionUnavailableReason) return props.actionUnavailableReason
  return `Use row actions to use, transfer, or manage ${activeSection.value.title} stacks, or choose an exact Trainer source to receive.`
})
const actionStatusRole = computed(() => (
  ['conflict', 'error'].includes(props.actionStatus) ? 'alert' : 'status'
))

const coerceMoney = (value: unknown): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : 0
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0
  return Math.floor(numericValue)
}
const setMoney = (event: Event) => {
  if (!props.canEdit) return
  props.document.money = coerceMoney((event.target as HTMLInputElement | null)?.value)
}
const sectionRows = (key: TrainerInventoryKey): GroupInventoryEntry[] => {
  const rows = props.document.inventory[key]
  if (rows) return rows
  props.document.inventory[key] = []
  return props.document.inventory[key]
}
const createEmptyRow = (key: TrainerInventoryKey, index: number): GroupInventoryEntry => {
  const row: GroupInventoryEntry = { id: createGroupInventoryRowId({ section: key, index }), name: '' }
  if (key !== 'equipment') row.qty = 1
  return row
}
const addItem = (key: TrainerInventoryKey) => {
  if (!props.canEdit) return
  const rows = sectionRows(key)
  rows.push(createEmptyRow(key, rows.length))
}
const removeItem = (key: TrainerInventoryKey, index: number) => {
  if (!props.canEdit) return
  sectionRows(key).splice(index, 1)
}
const setItemName = (item: InventoryEntry, value: string) => {
  if (!props.canEdit) return
  setTrainerInventoryItemName(item, value, activeSection.value.variant)
}

const groupItemOfferForRow = (sectionKey: TrainerInventoryKey, rowIndex: number): SheetItemActionOfferV1 | null => (
  props.itemActionOffers.find(offer => offer.source.section === sectionKey && offer.source.rowIndex === rowIndex) ?? null
)
const canUseGroupRow = (sectionKey: TrainerInventoryKey, rowIndex: number): boolean => {
  const offer = groupItemOfferForRow(sectionKey, rowIndex)
  return props.itemCanBegin && offer?.availability.enabled === true
    && offer.actions.find(action => action.kind === 'use')?.enabled === true
}
const groupItemButtonTitle = (sectionKey: TrainerInventoryKey, rowIndex: number): string => {
  if (props.itemUnavailableReason) return props.itemUnavailableReason
  const offer = groupItemOfferForRow(sectionKey, rowIndex)
  const use = offer?.actions.find(action => action.kind === 'use')
  if (!offer || !use) return 'No current server-issued use action is available for this shared row.'
  return use.unavailableReason?.label ?? offer.availability.unavailableReason?.label
    ?? `Use this exact shared row through ${offer.actor.label}.`
}
const captureWorkspaceOrigin = (): void => {
  const active = document.activeElement
  workspaceOrigin = active instanceof HTMLElement && active !== document.body ? active : null
}
const restoreWorkspaceFocus = async (): Promise<void> => {
  await nextTick()
  if (workspaceOrigin?.isConnected) workspaceOrigin.focus()
  else sectionTabs.value?.focusActive()
  workspaceOrigin = null
}
const openGroupItemUse = (sectionKey: TrainerInventoryKey, rowIndex: number) => {
  const offer = groupItemOfferForRow(sectionKey, rowIndex)
  if (!offer || !canUseGroupRow(sectionKey, rowIndex)) return
  captureWorkspaceOrigin()
  transferWorkspace.value = { direction: 'group-use', sectionKey, groupRowIndex: rowIndex }
  emit('openItemUse', offer)
}
const chooseItemOption = (choiceId: string, optionId: string) => emit('chooseItemOption', choiceId, optionId)
const chooseItemActor = (event: Event) => {
  if (props.itemBusy || props.itemStatus === 'uncertain') return
  const actorSelectionId = (event.target as HTMLSelectElement).value
  if (!props.itemActors.some(actor => actor.actorSelectionId === actorSelectionId)) return
  transferWorkspace.value = null
  emit('chooseItemActor', actorSelectionId)
}
const groupOffersForRow = (sectionKey: TrainerInventoryKey, rowIndex: number): readonly InventoryActionOfferV1[] => (
  props.actionOffers.filter(offer => (
    offer.source.locationKind === 'group-inventory'
    && offer.source.section === sectionKey
    && offer.source.rowLabel === `Row ${rowIndex + 1}`
  ))
)
const groupOfferForRow = (
  sectionKey: TrainerInventoryKey,
  rowIndex: number,
  action: InventoryActionOfferV1['action'],
): InventoryActionOfferV1 | null => groupOffersForRow(sectionKey, rowIndex).find(offer => offer.action === action) ?? null
const canTransferGroupRow = (sectionKey: TrainerInventoryKey, rowIndex: number): boolean => (
  props.actionCanBegin && groupOfferForRow(sectionKey, rowIndex, 'transfer')?.enabled === true
)
const groupRowReservationReason = (sectionKey: TrainerInventoryKey, rowIndex: number): string | null => {
  const itemOffer = groupItemOfferForRow(sectionKey, rowIndex)
  const reasons = [
    itemOffer?.availability.unavailableReason,
    itemOffer?.actions.find(action => action.kind === 'use')?.unavailableReason,
    ...groupOffersForRow(sectionKey, rowIndex).map(offer => offer.unavailableReason),
  ]
  const reserved = reasons.find(reason => reason
    && (reason.code.includes('reserved') || reason.label.toLocaleLowerCase('en-US').includes('reserved')))
  return reserved?.label ?? null
}
const groupActionButtonTitle = (
  sectionKey: TrainerInventoryKey,
  rowIndex: number,
  action: 'transfer' | 'split' | 'merge' | 'discard',
): string => {
  const offer = groupOfferForRow(sectionKey, rowIndex, action)
  if (props.actionUnavailableReason) return props.actionUnavailableReason
  if (!offer) return `No current server-issued ${action} action is available for this exact row.`
  return offer.unavailableReason?.label ?? (action === 'transfer'
    ? 'Transfer this exact shared inventory row to a Trainer.'
    : `${offer.label} this exact shared inventory stack.`)
}
const openTransferToTrainer = (sectionKey: TrainerInventoryKey, rowIndex: number) => {
  const offer = groupOfferForRow(sectionKey, rowIndex, 'transfer')
  if (!props.actionCanBegin || !offer?.enabled) return
  captureWorkspaceOrigin()
  transferWorkspace.value = { direction: 'group-to-trainer', sectionKey, groupRowIndex: rowIndex }
  emit('openAction', offer)
}
const openGroupStackAction = (
  sectionKey: TrainerInventoryKey,
  rowIndex: number,
  action: 'split' | 'merge' | 'discard',
) => {
  const offer = groupOfferForRow(sectionKey, rowIndex, action)
  if (!props.actionCanBegin || !offer?.enabled) return
  captureWorkspaceOrigin()
  transferWorkspace.value = { direction: 'group-stack', sectionKey, groupRowIndex: rowIndex }
  emit('openAction', offer)
}
const openTransferToGroup = () => {
  const offer = activeReceiveOffers.value.find(candidate => candidate.enabled)
  if (!props.actionCanBegin || !offer) return
  captureWorkspaceOrigin()
  transferWorkspace.value = { direction: 'trainer-to-group', sectionKey: activeSection.value.key }
  emit('openAction', offer)
}
const trainerSourceOffers = computed(() => transferWorkspace.value?.direction === 'trainer-to-group'
  ? sectionActionOffers(transferWorkspace.value.sectionKey, 'trainer-to-group')
  : [])
const sourceOptionLabel = (offer: InventoryActionOfferV1): string => (
  `${offer.source.containerLabel} · ${offer.source.rowLabel} · ${offer.source.itemLabel} · qty ${offer.source.availableQuantity}`
)
const chooseSource = (event: Event) => {
  const offerId = (event.target as HTMLSelectElement).value
  const offer = trainerSourceOffers.value.find(candidate => candidate.offerId === offerId)
  if (offer?.enabled && !props.actionBusy) emit('openAction', offer)
}
const closeWorkspace = async () => {
  if (transferWorkspace.value?.direction === 'group-use') {
    if (props.itemBusy || props.itemStatus === 'uncertain') return
    emit('cancelItemUse')
  }
  else {
    if (props.actionBusy || props.actionStatus === 'uncertain') return
    emit('cancelAction')
  }
  transferWorkspace.value = null
  await restoreWorkspaceFocus()
}
const dismissWorkspace = async () => {
  if (props.actionBusy || props.actionStatus === 'uncertain') return
  emit('dismissAction')
  transferWorkspace.value = null
  await restoreWorkspaceFocus()
}

watch(activeSectionKey, () => {
  if (synchronizingSelectedWorkspace || !transferWorkspace.value || props.actionBusy || props.itemBusy
    || props.actionStatus === 'uncertain' || props.itemStatus === 'uncertain') return
  if (transferWorkspace.value.direction === 'group-use') emit('cancelItemUse')
  else emit('cancelAction')
  transferWorkspace.value = null
  workspaceOrigin = null
})
watch(() => props.selectedActionOffer, async (offer) => {
  if (offer?.source.locationKind === 'group-inventory' && offer.source.section) {
    const match = /^Row ([1-9][0-9]*)$/u.exec(offer.source.rowLabel)
    synchronizingSelectedWorkspace = true
    activeSectionKey.value = offer.source.section
    transferWorkspace.value = {
      direction: groupStackActions.includes(offer.action as typeof groupStackActions[number]) ? 'group-stack' : 'group-to-trainer',
      sectionKey: offer.source.section,
      ...(match ? { groupRowIndex: Number(match[1]) - 1 } : {}),
    }
    await nextTick()
    synchronizingSelectedWorkspace = false
    return
  }
  if (transferWorkspace.value && transferWorkspace.value.direction !== 'group-use'
    && !offer && !['uncertain', 'accepted'].includes(props.actionStatus)) {
    transferWorkspace.value = null
    await restoreWorkspaceFocus()
  }
})
watch(() => props.selectedItemOffer, async (offer) => {
  if (offer) {
    synchronizingSelectedWorkspace = true
    activeSectionKey.value = offer.source.section
    transferWorkspace.value = {
      direction: 'group-use',
      sectionKey: offer.source.section,
      groupRowIndex: offer.source.rowIndex,
    }
    await nextTick()
    synchronizingSelectedWorkspace = false
    return
  }
  if (transferWorkspace.value?.direction === 'group-use'
    && !offer && !['uncertain', 'accepted', 'pending-gm'].includes(props.itemStatus)) {
    transferWorkspace.value = null
    await restoreWorkspaceFocus()
  }
})
</script>

<template>
  <article class="group-inventory-panel panel-card" aria-label="Shared party inventory">
    <header class="group-inventory-panel__header">
      <dl class="group-inventory-panel__summary" aria-label="Group inventory summary">
        <div>
          <dt>Money</dt>
          <dd v-if="canEdit" class="group-inventory-panel__money-editor">
            <label class="sr-only" for="group-inventory-money">Shared inventory money</label>
            <span aria-hidden="true">$</span>
            <input id="group-inventory-money" :value="document.money" type="number" min="0" step="1" inputmode="numeric" @input="setMoney">
          </dd>
          <dd v-else>{{ moneyDisplay }}</dd>
        </div>
      </dl>
    </header>

    <div v-if="canEdit" class="group-inventory-panel__save-bar" aria-label="Shared inventory save controls">
      <button type="button" class="group-inventory-panel__save-button" :disabled="!canSubmitSave" @click="emit('save')">
        {{ saveButtonLabel }}
      </button>
      <p v-if="saveStatusMessage" :class="['group-inventory-panel__save-message', `group-inventory-panel__save-message--${saveStatus}`]" :role="saveStatusRole" aria-live="polite">
        {{ saveStatusMessage }}
      </p>
      <button v-if="saveStatus === 'conflict'" type="button" class="group-inventory-panel__reload-button" @click="emit('reloadAfterConflict')">
        Reload authoritative inventory
      </button>
    </div>

    <div v-if="showTransferControls" class="group-inventory-panel__transfer-bar" aria-label="Shared inventory action controls">
      <div>
        <p class="group-inventory-panel__transfer-title">Authoritative inventory actions</p>
        <p v-if="actionStatusMessage" :class="['group-inventory-panel__transfer-message', `group-inventory-panel__transfer-message--${actionStatus}`]" :role="actionStatusRole" aria-live="polite">
          {{ actionStatusMessage }}
        </p>
      </div>
      <div class="group-inventory-panel__transfer-actions">
        <label v-if="showItemUseControls && itemActors.length" class="group-inventory-panel__actor-picker">
          <span>Acting Trainer</span>
          <select :value="selectedItemActorId ?? ''" :disabled="itemBusy || itemStatus === 'uncertain' || actionBusy" @change="chooseItemActor">
            <option v-for="actor in itemActors" :key="actor.actorSelectionId" :value="actor.actorSelectionId">
              {{ actor.label }}
            </option>
          </select>
          <small>Shared custody; targets stay within this Trainer’s authorised roster.</small>
        </label>
        <p v-else-if="showItemUseControls" class="group-inventory-panel__actor-empty">
          {{ itemUnavailableReason ?? 'No authorised Trainer actor is available for shared item use.' }}
        </p>
        <button
          type="button"
          class="group-inventory-panel__transfer-button"
          :disabled="!canReceiveFromTrainer"
          :aria-label="canReceiveFromTrainer
            ? 'Receive from trainer'
            : `Receive from trainer unavailable: ${actionUnavailableReason ?? 'No current exact Trainer source is available.'}`"
          @click="openTransferToGroup"
        >
          Receive from trainer
        </button>
        <button type="button" class="group-inventory-panel__reload-button" :disabled="actionBusy || itemBusy || actionStatus === 'uncertain' || itemStatus === 'uncertain'" @click="emit('refreshActions'); emit('refreshItemUses')">
          Refresh actions
        </button>
      </div>
    </div>

    <div
      class="group-inventory-panel__receipts-workspace"
      :class="{ 'has-decision': hasDecisionWorkspace }"
    >
      <div class="group-inventory-panel__primary-workspace">
        <p v-if="isInventoryEmpty" class="group-inventory-panel__empty" role="status" aria-live="polite">
          No shared inventory rows yet. The campaign inventory exists, but every section is empty.
        </p>

        <InventorySectionTabs
          ref="sectionTabs"
          v-model:active-section-key="activeSectionKey"
          :counts="inventorySectionCounts"
          id-prefix="group-inventory"
          panel-id="group-inventory-section-panel"
        />

        <div class="group-inventory-panel__workspace" :class="{ 'has-decision': hasDecisionWorkspace }">
      <div
        id="group-inventory-section-panel"
        class="group-inventory-panel__section"
        role="tabpanel"
        :aria-labelledby="`group-inventory-tab-${activeSection.key}`"
      >
        <InventoryItemTable
          :key="activeSection.key"
          :section-key="activeSection.key"
          :title="activeSection.title"
          :items="activeSectionItems"
          :name-placeholder="activeSection.namePlaceholder"
          :variant="activeSection.variant"
          :item-name-options="itemNameOptions"
          :read-only="!canEdit"
          :selected-row-index="transferWorkspace?.sectionKey === activeSection.key
            ? transferWorkspace.groupRowIndex ?? null
            : null"
          @add-item="addItem"
          @remove-item="removeItem"
          @set-item-name="setItemName"
        >
          <template v-if="showTransferControls" #rowActions="{ index, sectionKey }">
            <div class="group-inventory-panel__row-actions" role="group" :aria-label="`Row ${index + 1} inventory actions`">
              <button
                v-if="showItemUseControls"
                type="button"
                class="group-inventory-panel__row-use-button"
                :disabled="!canUseGroupRow(sectionKey, index)"
                :title="groupItemButtonTitle(sectionKey, index)"
                :aria-label="canUseGroupRow(sectionKey, index)
                  ? 'Use'
                  : `Use unavailable: ${groupItemButtonTitle(sectionKey, index)}`"
                @click="openGroupItemUse(sectionKey, index)"
              >
                Use
              </button>
              <button
                type="button"
                class="group-inventory-panel__row-transfer-button"
                :disabled="!canTransferGroupRow(sectionKey, index)"
                :title="groupActionButtonTitle(sectionKey, index, 'transfer')"
                :aria-label="canTransferGroupRow(sectionKey, index)
                  ? 'Transfer'
                  : `Transfer unavailable: ${groupActionButtonTitle(sectionKey, index, 'transfer')}`"
                @click="openTransferToTrainer(sectionKey, index)"
              >
                Transfer
              </button>
              <button
                v-for="action in groupStackActions"
                :key="action"
                type="button"
                class="group-inventory-panel__row-stack-button"
                :class="{ 'group-inventory-panel__row-stack-button--discard': action === 'discard' }"
                :disabled="!actionCanBegin || groupOfferForRow(sectionKey, index, action)?.enabled !== true"
                :title="groupActionButtonTitle(sectionKey, index, action)"
                :aria-label="actionCanBegin && groupOfferForRow(sectionKey, index, action)?.enabled === true
                  ? action.charAt(0).toUpperCase() + action.slice(1)
                  : `${action.charAt(0).toUpperCase() + action.slice(1)} unavailable: ${groupActionButtonTitle(sectionKey, index, action)}`"
                @click="openGroupStackAction(sectionKey, index, action)"
              >
                {{ action.charAt(0).toUpperCase() + action.slice(1) }}
              </button>
              <p v-if="groupRowReservationReason(sectionKey, index)" class="group-inventory-panel__row-reservation">
                Reserved: {{ groupRowReservationReason(sectionKey, index) }}
              </p>
            </div>
          </template>
        </InventoryItemTable>
      </div>

      <aside v-if="hasDecisionWorkspace" class="group-inventory-panel__decision" :aria-label="activeWorkspaceDirection === 'group-use' ? 'Shared item use decision' : 'Inventory action decision'">
        <TrainerSheetItemDecision
          v-if="activeWorkspaceDirection === 'group-use'"
          :offer="selectedItemOffer"
          :selected-target-ids="itemSelectedTargetIds"
          :selected-choices="itemSelectedChoices"
          :status="itemStatus"
          :message="itemMessage"
          :accepted-sheet-links="itemAcceptedSheetLinks"
          :busy="itemBusy"
          :recovery-online="itemRecoveryOnline"
          :exact-retry-available="itemExactRetryAvailable"
          @choose-target="emit('chooseItemTarget', $event)"
          @choose-option="chooseItemOption"
          @confirm="emit('confirmItemUse')"
          @cancel="closeWorkspace"
          @retry-exact="emit('retryExactItemUse')"
          @refresh="emit('refreshItemUses')"
        />
        <label v-else-if="activeWorkspaceDirection === 'trainer-to-group'" class="group-inventory-panel__source-picker">
          <span>Exact Trainer source</span>
          <select :value="selectedActionOffer?.offerId ?? ''" :disabled="actionBusy" @change="chooseSource">
            <option v-for="offer in trainerSourceOffers" :key="offer.offerId" :value="offer.offerId" :disabled="!offer.enabled">
              {{ sourceOptionLabel(offer) }}
            </option>
          </select>
          <small>Safe labels identify the current presentation row; the server retains private row authority.</small>
        </label>
        <InventoryActionDecision
          v-if="activeWorkspaceDirection !== 'group-use'"
          :offer="selectedActionOffer"
          :selected-destination-id="selectedDestinationId"
          :quantity="selectedQuantity"
          :selected-confirmation-option-id="selectedConfirmationOptionId"
          :status="actionStatus"
          :message="actionMessage"
          :busy="actionBusy"
          :recovery-online="actionRecoveryOnline"
          :exact-retry-available="actionExactRetryAvailable"
          @choose-destination="emit('chooseDestination', $event)"
          @set-quantity="emit('setQuantity', $event)"
          @set-confirmation="emit('setConfirmation', $event)"
          @confirm="emit('confirmAction')"
          @cancel="closeWorkspace"
          @retry-exact="emit('retryExact')"
          @refresh="emit('refreshActions')"
          @dismiss="dismissWorkspace"
        />
          </aside>
        </div>
      </div>

      <InventoryHistoryPanel
        :projection="inventoryHistory"
        :status="inventoryHistoryStatus"
        :error="inventoryHistoryError"
        @refresh="emit('refreshInventoryHistory')"
      />
    </div>

    <aside v-if="notes" class="group-inventory-panel__notes" aria-label="Group inventory notes">
      <h3>Notes</h3>
      <p>{{ notes }}</p>
    </aside>
  </article>
</template>

<style scoped>
.group-inventory-panel { display: grid; min-width: 0; max-width: 100%; gap: 1rem; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.group-inventory-panel__header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 1rem; }
.group-inventory-panel h3 { margin: 0; color: var(--ink-bright); font-family: var(--font-book); font-size: 1.1rem; letter-spacing: 0.04em; }
.group-inventory-panel__summary { display: grid; grid-template-columns: minmax(5.5rem, 1fr); gap: 0.5rem; min-width: min(100%, 24rem); margin: 0; }
.group-inventory-panel__summary div { display: grid; gap: 0.2rem; padding: 0.65rem 0.75rem; border: 1px solid var(--rule-soft); border-radius: 12px; background: var(--paper-inset); }
.group-inventory-panel__summary dt { color: var(--ink-muted); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.group-inventory-panel__summary dd { margin: 0; color: var(--ink-bright); font-weight: 900; }
.group-inventory-panel__money-editor { display: inline-flex; align-items: center; gap: 0.25rem; }
.group-inventory-panel__money-editor input { width: 8rem; min-height: 2.75rem; border: 1px solid var(--rule-soft); border-radius: 8px; background: var(--paper); color: var(--ink-bright); font: inherit; font-weight: 900; padding: 0.35rem 0.45rem; }
.group-inventory-panel__money-editor input:focus-visible { border-color: var(--rt-focus); outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.group-inventory-panel__save-bar,
.group-inventory-panel__transfer-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.55rem 0.7rem; border: 1px solid var(--rule-soft); border-radius: 10px; background: var(--paper-inset); padding: 0.7rem 0.8rem; }
.group-inventory-panel__save-button,
.group-inventory-panel__reload-button,
.group-inventory-panel__transfer-button,
.group-inventory-panel__row-transfer-button { min-height: 2.75rem; border: 1px solid var(--rule-active); border-radius: 6px; background: var(--paper-soft); color: var(--ink-bright); cursor: pointer; font: inherit; font-size: 0.78rem; font-weight: 900; letter-spacing: 0.06em; padding: 0.5rem 0.8rem; text-transform: uppercase; }
.group-inventory-panel__transfer-button,
.group-inventory-panel__row-transfer-button { border-color: var(--rt-brand); background: var(--rt-brand); color: var(--rt-on-brand); }
.group-inventory-panel__actor-picker { display: grid; min-width: min(100%, 18rem); gap: 0.22rem; color: var(--ink-bright); font-size: 0.72rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.group-inventory-panel__actor-picker select { min-height: 2.75rem; border: 1px solid var(--rule-active); border-radius: 6px; background: var(--paper-soft); color: var(--ink-bright); padding: 0.45rem 0.6rem; font: inherit; font-weight: 800; text-transform: none; }
.group-inventory-panel__actor-picker select:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.group-inventory-panel__actor-picker small,
.group-inventory-panel__actor-empty { margin: 0; color: var(--ink-muted); font-size: 0.72rem; font-weight: 500; letter-spacing: 0; line-height: 1.35; text-transform: none; }
.group-inventory-panel__row-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.3rem; }
.group-inventory-panel__row-reservation { flex: 1 0 100%; margin: 0; color: var(--rt-pending); font-size: 0.72rem; line-height: 1.35; text-align: right; }
.group-inventory-panel__row-use-button,
.group-inventory-panel__row-transfer-button,
.group-inventory-panel__row-stack-button {
  min-width: 2.75rem;
  min-height: 2.75rem;
  border: 1px solid var(--rule-active);
  border-radius: 6px;
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}
.group-inventory-panel__row-use-button { border-color: var(--rt-brand); background: var(--rt-brand); color: var(--rt-on-brand); }
.group-inventory-panel__row-stack-button { background: var(--paper-soft); color: var(--ink-muted); }
.group-inventory-panel__row-stack-button--discard:not(:disabled) { color: var(--rt-danger); }
.group-inventory-panel__save-button:hover:not(:disabled),
.group-inventory-panel__save-button:focus-visible:not(:disabled),
.group-inventory-panel__reload-button:hover:not(:disabled),
.group-inventory-panel__reload-button:focus-visible:not(:disabled),
.group-inventory-panel__transfer-button:hover:not(:disabled),
.group-inventory-panel__transfer-button:focus-visible:not(:disabled),
.group-inventory-panel__row-use-button:hover:not(:disabled),
.group-inventory-panel__row-use-button:focus-visible:not(:disabled),
.group-inventory-panel__row-transfer-button:hover:not(:disabled),
.group-inventory-panel__row-transfer-button:focus-visible:not(:disabled),
.group-inventory-panel__row-stack-button:hover:not(:disabled),
.group-inventory-panel__row-stack-button:focus-visible:not(:disabled) { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.group-inventory-panel button:disabled { border-color: var(--rule); background: var(--paper-inset); color: var(--ink-faint); cursor: not-allowed; }
.group-inventory-panel__save-message,
.group-inventory-panel__transfer-message,
.group-inventory-panel__transfer-title { margin: 0; color: var(--ink-soft); font-size: 0.88rem; font-weight: 700; }
.group-inventory-panel__transfer-title { color: var(--ink-bright); font-size: 0.78rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
.group-inventory-panel__transfer-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
.group-inventory-panel__save-message--saved,
.group-inventory-panel__transfer-message--accepted { color: var(--rt-success); }
.group-inventory-panel__save-message--conflict,
.group-inventory-panel__save-message--error,
.group-inventory-panel__transfer-message--conflict,
.group-inventory-panel__transfer-message--error { color: var(--bad, #ffb3b3); }
.group-inventory-panel__empty,
.group-inventory-panel__notes { border: 1px dashed var(--rule-soft); border-radius: 10px; background: var(--paper-inset); padding: 0.8rem 0.9rem; color: var(--ink-soft); }
.group-inventory-panel__empty,
.group-inventory-panel__notes p { margin: 0; line-height: 1.55; }
.group-inventory-panel__receipts-workspace { display: grid; min-width: 0; grid-template-columns: minmax(0, 3fr) minmax(19rem, 2fr); align-items: start; gap: 1rem; }
.group-inventory-panel__receipts-workspace.has-decision { grid-template-columns: minmax(0, 1fr); }
.group-inventory-panel__primary-workspace { display: grid; min-width: 0; gap: 1rem; }
.group-inventory-panel__workspace { display: grid; min-width: 0; gap: 1rem; }
.group-inventory-panel__workspace.has-decision { grid-template-columns: minmax(0, 3fr) minmax(19rem, 2fr); align-items: start; }
.group-inventory-panel__section,
.group-inventory-panel__decision { min-width: 0; max-width: 100%; }
.group-inventory-panel__section :deep(.inv-block) { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.group-inventory-panel__section :deep(.inv-table) { min-width: 42rem; }
.group-inventory-panel__decision { display: grid; gap: 0.75rem; }
.group-inventory-panel__source-picker { display: grid; gap: 0.35rem; border: 1px solid var(--rule-soft); border-radius: 7px; background: var(--paper-soft); padding: 0.75rem; color: var(--ink-bright); font-weight: 800; }
.group-inventory-panel__source-picker select { min-height: 2.75rem; width: 100%; border: 1px solid var(--rule-soft); border-radius: 6px; background: var(--paper-inset); color: var(--ink-bright); padding: 0.45rem 0.6rem; font: inherit; }
.group-inventory-panel__source-picker select:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 2px; }
.group-inventory-panel__source-picker small { color: var(--ink-muted); font-weight: 400; line-height: 1.4; }
@media (max-width: 1200px) {
  .group-inventory-panel__receipts-workspace { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 860px) {
  .group-inventory-panel__workspace.has-decision { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .group-inventory-panel__section :deep(.inv-block) { overflow: visible; }
  .group-inventory-panel__section :deep(.inv-table) { min-width: 0; }
  .group-inventory-panel__row-actions { width: 100%; justify-content: flex-start; }
  .group-inventory-panel__row-actions button { flex: 1 1 6rem; font-size: 0.75rem; }
  .group-inventory-panel__row-reservation { text-align: left; }
}
@media (max-width: 560px) {
  .group-inventory-panel__save-bar,
  .group-inventory-panel__transfer-bar { align-items: stretch; }
  .group-inventory-panel__transfer-actions { display: grid; width: 100%; grid-template-columns: 1fr; }
  .group-inventory-panel__transfer-actions button { width: 100%; }
  .group-inventory-panel__row-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .group-inventory-panel__row-actions button { width: 100%; }
  .group-inventory-panel__row-reservation { grid-column: 1 / -1; }
}
</style>
