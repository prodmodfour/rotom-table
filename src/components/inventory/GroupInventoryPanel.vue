<script setup lang="ts">
import { computed, ref } from 'vue'
import InventoryItemTable from '~/components/inventory/InventoryItemTable.vue'
import InventorySectionTabs from '~/components/inventory/InventorySectionTabs.vue'
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

const props = withDefaults(defineProps<{
  document: GroupInventoryDocument
  canEdit?: boolean
  isDirty?: boolean
  saveStatus?: GroupInventorySaveStatus
  saveError?: string | null
}>(), {
  canEdit: false,
  isDirty: false,
  saveStatus: 'idle',
  saveError: null,
})

const emit = defineEmits<{
  save: []
  reloadAfterConflict: []
}>()

const activeSectionKey = ref<TrainerInventoryKey>(TRAINER_INVENTORY_SECTIONS[0].key)
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
            This read-only view shows the authoritative campaign inventory document for both GMs and players.
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
      />
    </div>

    <aside v-if="notes" class="group-inventory-panel__notes" aria-label="Group inventory notes">
      <h3>Notes</h3>
      <p>{{ notes }}</p>
    </aside>
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

.group-inventory-panel__save-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 0.7rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.8rem;
}

.group-inventory-panel__save-button,
.group-inventory-panel__reload-button {
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

.group-inventory-panel__save-button:hover:not(:disabled),
.group-inventory-panel__save-button:focus-visible:not(:disabled),
.group-inventory-panel__reload-button:hover,
.group-inventory-panel__reload-button:focus-visible {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.22);
  outline: none;
}

.group-inventory-panel__save-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.group-inventory-panel__save-message {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
  font-weight: 700;
}

.group-inventory-panel__save-message--saved {
  color: var(--good, #9be282);
}

.group-inventory-panel__save-message--conflict,
.group-inventory-panel__save-message--error {
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
