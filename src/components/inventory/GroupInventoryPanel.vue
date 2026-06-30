<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GroupInventoryTransferDialog from '~/components/inventory/GroupInventoryTransferDialog.vue'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
import {
  createGroupInventoryRowId,
  type GroupInventoryDocument,
  type GroupInventoryEntry,
} from '~/types/groupInventory'
import type { InventoryEntry } from '~/types/trainerSheet'
import type {
  GroupInventoryTrainerLoadStatus,
  GroupInventoryTransferDirection,
  GroupInventoryTransferStatus,
  GroupInventoryTransferToGroupRequest,
  GroupInventoryTransferToTrainerRequest,
  GroupInventoryTransferTrainerOption,
} from '~/types/groupInventoryTransferUi'
import {
  setTrainerInventoryItemName,
  trainerInventoryItemOptions,
} from '~/utils/sheets/trainerInventoryItems'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { GroupInventorySaveStatus } from '~/composables/useGroupInventoryEditor'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

const props = withDefaults(defineProps<{
  document: GroupInventoryDocument
  canEdit?: boolean
  isDirty?: boolean
  saveStatus?: GroupInventorySaveStatus
  saveError?: string | null
  canTransfer?: boolean
  transferUnavailableReason?: string | null
  transferTrainers?: readonly GroupInventoryTransferTrainerOption[]
  trainerLoadStatus?: GroupInventoryTrainerLoadStatus
  trainerLoadError?: string | null
  transferStatus?: GroupInventoryTransferStatus
  transferError?: string | null
  transferNotice?: string | null
}>(), {
  canEdit: false,
  isDirty: false,
  saveStatus: 'idle',
  saveError: null,
  canTransfer: false,
  transferUnavailableReason: null,
  transferTrainers: () => [],
  trainerLoadStatus: 'idle',
  trainerLoadError: null,
  transferStatus: 'idle',
  transferError: null,
  transferNotice: null,
})

const emit = defineEmits<{
  save: []
  reloadAfterConflict: []
  refreshTransferTrainers: []
  transferToTrainer: [request: GroupInventoryTransferToTrainerRequest]
  transferToGroup: [request: GroupInventoryTransferToGroupRequest]
}>()

type TransferDialogState =
  | {
    readonly direction: 'group-to-trainer'
    readonly sectionKey: TrainerInventoryKey
    readonly groupRow: GroupInventoryEntry
  }
  | {
    readonly direction: 'trainer-to-group'
    readonly sectionKey: TrainerInventoryKey
    readonly groupRow?: null
  }

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
const transferDialog = ref<TransferDialogState | null>(null)
const activeSection = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((section) => section.key === activeSectionKey.value)
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
  if (props.saveStatus === 'conflict') {
    return props.saveError ?? 'The shared inventory changed elsewhere. Reload before saving again.'
  }
  if (props.saveStatus === 'error') return props.saveError ?? 'The shared inventory could not be saved.'
  return null
})
const saveStatusRole = computed(() => (props.saveStatus === 'conflict' || props.saveStatus === 'error' ? 'alert' : 'status'))

const hasTransferTrainers = computed(() => props.transferTrainers.length > 0)
const isTransferBusy = computed(() => props.transferStatus === 'loading')
const showTransferControls = computed(() => (
  props.canTransfer
  || !!props.transferUnavailableReason
  || props.trainerLoadStatus === 'loading'
  || props.trainerLoadStatus === 'error'
  || props.transferStatus !== 'idle'
))
const canOpenTransferDialog = computed(() => (
  props.canTransfer && hasTransferTrainers.value && !isTransferBusy.value && !props.transferUnavailableReason
))
const transferStatusMessage = computed(() => {
  if (props.transferStatus === 'loading') return 'Transferring inventory with revision checks…'
  if (props.transferStatus === 'success') return props.transferNotice ?? 'Inventory transfer complete.'
  if (props.transferStatus === 'conflict') {
    return props.transferError ?? 'The group inventory or trainer sheet changed. Reload before transferring again.'
  }
  if (props.transferStatus === 'error') return props.transferError ?? 'The inventory transfer could not be completed.'
  if (props.trainerLoadStatus === 'loading') return 'Loading eligible trainer sheets…'
  if (props.trainerLoadStatus === 'error') return props.trainerLoadError ?? 'Eligible trainer sheets could not be loaded.'
  if (props.transferUnavailableReason) return props.transferUnavailableReason
  if (props.canTransfer) {
    return `Use row Transfer buttons to send ${activeSection.value.title} to trainers, or receive rows from an eligible trainer.`
  }
  return null
})
const transferStatusRole = computed(() => (
  props.transferStatus === 'conflict'
  || props.transferStatus === 'error'
  || props.trainerLoadStatus === 'error'
    ? 'alert'
    : 'status'
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
  const target = event.target as HTMLInputElement | null
  props.document.money = coerceMoney(target?.value)
}

const sectionRows = (key: TrainerInventoryKey): GroupInventoryEntry[] => {
  const rows = props.document.inventory[key]
  if (rows) return rows
  props.document.inventory[key] = []
  return props.document.inventory[key]
}

const createEmptyRow = (key: TrainerInventoryKey, index: number): GroupInventoryEntry => {
  const row: GroupInventoryEntry = {
    id: createGroupInventoryRowId({ section: key, index }),
    name: '',
  }
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

const inventoryEntryQuantity = (item: InventoryEntry, sectionKey: TrainerInventoryKey): number => {
  if (sectionKey === 'equipment') return 1
  const quantity = item.qty
  return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
    ? Math.floor(quantity)
    : 0
}

const groupRowFromInventoryEntry = (item: InventoryEntry): GroupInventoryEntry | null => {
  const candidate = item as GroupInventoryEntry
  return typeof candidate.id === 'string' && candidate.id.trim() ? candidate : null
}

const canTransferGroupRow = (item: InventoryEntry, sectionKey: TrainerInventoryKey): boolean => (
  canOpenTransferDialog.value
  && groupRowFromInventoryEntry(item) !== null
  && inventoryEntryQuantity(item, sectionKey) > 0
)

const groupTransferButtonTitle = (item: InventoryEntry, sectionKey: TrainerInventoryKey): string => {
  if (props.transferUnavailableReason) return props.transferUnavailableReason
  if (!hasTransferTrainers.value) return 'No eligible trainer sheets are available for transfers.'
  if (isTransferBusy.value) return 'An inventory transfer is already in progress.'
  if (groupRowFromInventoryEntry(item) === null) return 'This shared inventory row is missing its row id.'
  if (inventoryEntryQuantity(item, sectionKey) <= 0) return 'This shared inventory row has no transferable quantity.'
  return 'Transfer this shared inventory row to a trainer.'
}

const openTransferToTrainer = (item: InventoryEntry, sectionKey: TrainerInventoryKey) => {
  if (!canTransferGroupRow(item, sectionKey)) return
  const groupRow = groupRowFromInventoryEntry(item)
  if (!groupRow) return
  transferDialog.value = {
    direction: 'group-to-trainer',
    sectionKey,
    groupRow,
  }
}

const openTransferToGroup = () => {
  if (!canOpenTransferDialog.value) return
  transferDialog.value = {
    direction: 'trainer-to-group',
    sectionKey: activeSection.value.key,
  }
}

const closeTransferDialog = () => {
  if (isTransferBusy.value) return
  transferDialog.value = null
}

const transferDialogDirection = computed<GroupInventoryTransferDirection | null>(() => transferDialog.value?.direction ?? null)
const transferDialogSectionKey = computed(() => transferDialog.value?.sectionKey ?? activeSection.value.key)
const transferDialogGroupRow = computed(() => (
  transferDialog.value?.direction === 'group-to-trainer' ? transferDialog.value.groupRow : null
))

watch(
  () => props.transferStatus,
  (status) => {
    if (status === 'success') transferDialog.value = null
  },
)
</script>

<template>
  <article class="group-inventory-panel panel-card" aria-labelledby="group-inventory-panel-title">
    <header class="group-inventory-panel__header">
      <div>
        <p class="group-inventory-panel__eyebrow">Shared campaign state</p>
        <h2 id="group-inventory-panel-title">Shared party inventory</h2>
        <p>
          <template v-if="canEdit">
            Edit the authoritative campaign inventory document, then save with revision protection before other clients rely on the changes.
          </template>
          <template v-else>
            This view shows the authoritative campaign inventory document for both GMs and players.
          </template>
          <template v-if="showTransferControls">
            Transfers move item quantities only after the server accepts both the party and trainer revisions.
          </template>
        </p>
      </div>

      <dl class="group-inventory-panel__summary" aria-label="Group inventory summary">
        <div>
          <dt>Money</dt>
          <dd v-if="canEdit" class="group-inventory-panel__money-editor">
            <label class="sr-only" for="group-inventory-money">Shared inventory money</label>
            <span aria-hidden="true">$</span>
            <input
              id="group-inventory-money"
              :value="document.money"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              @input="setMoney"
            >
          </dd>
          <dd v-else>{{ moneyDisplay }}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{{ totalItemRows }}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{{ document.revision }}</dd>
        </div>
      </dl>
    </header>

    <div v-if="canEdit" class="group-inventory-panel__save-bar" aria-label="Shared inventory save controls">
      <button
        type="button"
        class="group-inventory-panel__save-button"
        :disabled="!canSubmitSave"
        @click="emit('save')"
      >
        {{ saveButtonLabel }}
      </button>
      <p
        v-if="saveStatusMessage"
        :class="[
          'group-inventory-panel__save-message',
          `group-inventory-panel__save-message--${saveStatus}`,
        ]"
        :role="saveStatusRole"
        aria-live="polite"
      >
        {{ saveStatusMessage }}
      </p>
      <button
        v-if="saveStatus === 'conflict'"
        type="button"
        class="group-inventory-panel__reload-button"
        @click="emit('reloadAfterConflict')"
      >
        Reload authoritative inventory
      </button>
    </div>

    <div v-if="showTransferControls" class="group-inventory-panel__transfer-bar" aria-label="Shared inventory transfer controls">
      <div>
        <p class="group-inventory-panel__transfer-title">Trainer transfers</p>
        <p
          v-if="transferStatusMessage"
          :class="[
            'group-inventory-panel__transfer-message',
            `group-inventory-panel__transfer-message--${transferStatus}`,
          ]"
          :role="transferStatusRole"
          aria-live="polite"
        >
          {{ transferStatusMessage }}
        </p>
      </div>
      <div class="group-inventory-panel__transfer-actions">
        <button
          type="button"
          class="group-inventory-panel__transfer-button"
          :disabled="!canOpenTransferDialog"
          @click="openTransferToGroup"
        >
          Receive from trainer
        </button>
        <button
          v-if="transferStatus === 'conflict'"
          type="button"
          class="group-inventory-panel__reload-button"
          @click="emit('reloadAfterConflict')"
        >
          Reload inventory
        </button>
        <button
          type="button"
          class="group-inventory-panel__reload-button"
          :disabled="trainerLoadStatus === 'loading'"
          @click="emit('refreshTransferTrainers')"
        >
          Refresh trainers
        </button>
      </div>
    </div>

    <p
      v-if="isInventoryEmpty"
      class="group-inventory-panel__empty"
      role="status"
      aria-live="polite"
    >
      No shared inventory rows yet. The campaign inventory exists, but every section is empty.
    </p>

    <InventorySectionTabs
      v-model:active-section-key="activeSectionKey"
      :counts="inventorySectionCounts"
    />

    <div class="group-inventory-panel__section">
      <InventoryItemTable
        :key="activeSection.key"
        :section-key="activeSection.key"
        :title="activeSection.title"
        :items="activeSectionItems"
        :name-placeholder="activeSection.namePlaceholder"
        :variant="activeSection.variant"
        :item-name-options="itemNameOptions"
        :read-only="!canEdit"
        @add-item="addItem"
        @remove-item="removeItem"
        @set-item-name="setItemName"
      >
        <template v-if="showTransferControls" #rowActions="{ item, sectionKey }">
          <button
            type="button"
            class="group-inventory-panel__row-transfer-button"
            :disabled="!canTransferGroupRow(item, sectionKey)"
            :title="groupTransferButtonTitle(item, sectionKey)"
            @click="openTransferToTrainer(item, sectionKey)"
          >
            Transfer
          </button>
        </template>
      </InventoryItemTable>
    </div>

    <aside v-if="notes" class="group-inventory-panel__notes" aria-label="Group inventory notes">
      <h3>Notes</h3>
      <p>{{ notes }}</p>
    </aside>

    <GroupInventoryTransferDialog
      v-if="transferDialogDirection"
      :direction="transferDialogDirection"
      :section-key="transferDialogSectionKey"
      :group-row="transferDialogGroupRow"
      :trainers="transferTrainers"
      :status="transferStatus"
      :error="transferError"
      @close="closeTransferDialog"
      @transfer-to-trainer="(request) => emit('transferToTrainer', request)"
      @transfer-to-group="(request) => emit('transferToGroup', request)"
    />
  </article>
</template>

<style scoped>
.group-inventory-panel {
  display: grid;
  gap: 1rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.group-inventory-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.group-inventory-panel__header p {
  max-width: 68ch;
  margin: 0.35rem 0 0;
  color: var(--ink-soft);
  line-height: 1.55;
}

.group-inventory-panel__header .group-inventory-panel__eyebrow {
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-inventory-panel h2,
.group-inventory-panel h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.group-inventory-panel h2 {
  font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.group-inventory-panel h3 {
  font-size: 1.1rem;
}

.group-inventory-panel__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(5.5rem, 1fr));
  gap: 0.5rem;
  min-width: min(100%, 24rem);
  margin: 0;
}

.group-inventory-panel__summary div {
  display: grid;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.group-inventory-panel__summary dt {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.group-inventory-panel__summary dd {
  margin: 0;
  color: var(--ink-bright);
  font-weight: 900;
}

.group-inventory-panel__money-editor {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.group-inventory-panel__money-editor input {
  width: 8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink-bright);
  font: inherit;
  font-weight: 900;
  padding: 0.35rem 0.45rem;
}

.group-inventory-panel__money-editor input:focus-visible {
  border-color: var(--accent);
  outline: 2px solid rgba(var(--accent-rgb), 0.24);
  outline-offset: 2px;
}

.group-inventory-panel__save-bar,
.group-inventory-panel__transfer-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem 0.7rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.8rem;
}

.group-inventory-panel__save-button,
.group-inventory-panel__reload-button,
.group-inventory-panel__transfer-button,
.group-inventory-panel__row-transfer-button {
  border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--rule-soft));
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.14);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.5rem 0.8rem;
  text-transform: uppercase;
}

.group-inventory-panel__reload-button {
  background: var(--paper-soft);
  color: var(--accent);
}

.group-inventory-panel__row-transfer-button {
  margin-right: 0.35rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.68rem;
}

.group-inventory-panel__save-button:hover:not(:disabled),
.group-inventory-panel__save-button:focus-visible:not(:disabled),
.group-inventory-panel__reload-button:hover:not(:disabled),
.group-inventory-panel__reload-button:focus-visible:not(:disabled),
.group-inventory-panel__transfer-button:hover:not(:disabled),
.group-inventory-panel__transfer-button:focus-visible:not(:disabled),
.group-inventory-panel__row-transfer-button:hover:not(:disabled),
.group-inventory-panel__row-transfer-button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.22);
  outline: none;
}

.group-inventory-panel__save-button:disabled,
.group-inventory-panel__reload-button:disabled,
.group-inventory-panel__transfer-button:disabled,
.group-inventory-panel__row-transfer-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.group-inventory-panel__save-message,
.group-inventory-panel__transfer-message,
.group-inventory-panel__transfer-title {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
  font-weight: 700;
}

.group-inventory-panel__transfer-title {
  color: var(--ink-bright);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.group-inventory-panel__transfer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.group-inventory-panel__save-message--saved,
.group-inventory-panel__transfer-message--success {
  color: var(--good, #9be282);
}

.group-inventory-panel__save-message--conflict,
.group-inventory-panel__save-message--error,
.group-inventory-panel__transfer-message--conflict,
.group-inventory-panel__transfer-message--error {
  color: var(--bad, #ffb3b3);
}

.group-inventory-panel__empty,
.group-inventory-panel__notes {
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.8rem 0.9rem;
  color: var(--ink-soft);
}

.group-inventory-panel__empty,
.group-inventory-panel__notes p {
  margin: 0;
  line-height: 1.55;
}

.group-inventory-panel__section {
  min-width: 0;
}
</style>
