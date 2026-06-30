<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GroupInventoryEntry, GroupInventorySectionKey } from '~/types/groupInventory'
import type { InventoryEntry } from '~/types/trainerSheet'
import type {
  GroupInventoryTransferDirection,
  GroupInventoryTransferStatus,
  GroupInventoryTransferToGroupRequest,
  GroupInventoryTransferToTrainerRequest,
  GroupInventoryTransferTrainerOption,
} from '~/types/groupInventoryTransferUi'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'

const props = withDefaults(defineProps<{
  direction: GroupInventoryTransferDirection
  sectionKey: GroupInventorySectionKey
  groupRow?: GroupInventoryEntry | null
  trainers: readonly GroupInventoryTransferTrainerOption[]
  status?: GroupInventoryTransferStatus
  error?: string | null
}>(), {
  groupRow: null,
  status: 'idle',
  error: null,
})

const emit = defineEmits<{
  close: []
  transferToTrainer: [request: GroupInventoryTransferToTrainerRequest]
  transferToGroup: [request: GroupInventoryTransferToGroupRequest]
}>()

const selectedTrainerSlug = ref(props.trainers[0]?.slug ?? '')
const selectedTrainerRowIndex = ref(0)
const quantity = ref(1)

const section = computed(() => (
  TRAINER_INVENTORY_SECTIONS.find((candidate) => candidate.key === props.sectionKey)
  ?? TRAINER_INVENTORY_SECTIONS[0]
))
const isEquipmentTransfer = computed(() => props.sectionKey === 'equipment')
const isBusy = computed(() => props.status === 'loading')
const selectedTrainer = computed(() => props.trainers.find((trainer) => trainer.slug === selectedTrainerSlug.value) ?? null)
const trainerRows = computed<readonly InventoryEntry[]>(() => selectedTrainer.value?.inventory[props.sectionKey] ?? [])
const selectedTrainerRow = computed(() => trainerRows.value[selectedTrainerRowIndex.value] ?? null)

const displayItemName = (entry: Pick<InventoryEntry, 'name'> | null | undefined): string => {
  const name = entry?.name?.trim()
  return name || 'Unnamed item'
}

const groupSourceQuantity = computed(() => {
  if (isEquipmentTransfer.value) return 1
  const rawQuantity = props.groupRow?.qty
  return typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) && rawQuantity > 0
    ? Math.floor(rawQuantity)
    : 0
})
const trainerSourceQuantity = computed(() => {
  if (isEquipmentTransfer.value) return selectedTrainerRow.value ? 1 : 0
  const rawQuantity = selectedTrainerRow.value?.qty
  return typeof rawQuantity === 'number' && Number.isFinite(rawQuantity) && rawQuantity > 0
    ? Math.floor(rawQuantity)
    : 0
})
const maxQuantity = computed(() => (
  props.direction === 'group-to-trainer' ? groupSourceQuantity.value : trainerSourceQuantity.value
))
const sourceItemName = computed(() => (
  props.direction === 'group-to-trainer'
    ? displayItemName(props.groupRow)
    : displayItemName(selectedTrainerRow.value)
))
const dialogTitle = computed(() => (
  props.direction === 'group-to-trainer'
    ? `Transfer ${sourceItemName.value} to a trainer`
    : `Transfer ${section.value.title} from a trainer`
))
const submitLabel = computed(() => (
  props.status === 'loading'
    ? 'Transferring…'
    : props.direction === 'group-to-trainer'
      ? 'Transfer to trainer'
      : 'Transfer to party inventory'
))
const hasTrainerRows = computed(() => trainerRows.value.length > 0)
const validationMessage = computed(() => {
  if (!selectedTrainer.value) return 'Choose an eligible trainer sheet.'
  if (props.direction === 'group-to-trainer' && !props.groupRow?.id) return 'Choose a shared inventory row to transfer.'
  if (props.direction === 'trainer-to-group' && !hasTrainerRows.value) {
    return `${selectedTrainer.value.name} has no rows in ${section.value.title}.`
  }
  if (maxQuantity.value <= 0) return 'The selected source row has no transferable quantity.'
  if (!isEquipmentTransfer.value && quantity.value > maxQuantity.value) return `Quantity cannot exceed ${maxQuantity.value}.`
  return null
})
const submitDisabled = computed(() => isBusy.value || validationMessage.value !== null)

const clampQuantity = () => {
  if (isEquipmentTransfer.value) {
    quantity.value = 1
    return
  }

  const max = Math.max(1, maxQuantity.value)
  if (!Number.isFinite(quantity.value) || quantity.value < 1) {
    quantity.value = 1
    return
  }
  quantity.value = Math.min(Math.floor(quantity.value), max)
}

const setQuantity = (event: Event) => {
  if (isEquipmentTransfer.value) return
  const target = event.target as HTMLInputElement | null
  quantity.value = Number(target?.value ?? 1)
  clampQuantity()
}

const submit = () => {
  if (submitDisabled.value || !selectedTrainer.value) return
  const transferQuantity = isEquipmentTransfer.value ? 1 : quantity.value

  if (props.direction === 'group-to-trainer') {
    if (!props.groupRow?.id) return
    emit('transferToTrainer', {
      trainerSlug: selectedTrainer.value.slug,
      section: props.sectionKey,
      itemId: props.groupRow.id,
      quantity: transferQuantity,
    })
    return
  }

  emit('transferToGroup', {
    trainerSlug: selectedTrainer.value.slug,
    section: props.sectionKey,
    trainerRowIndex: selectedTrainerRowIndex.value,
    quantity: transferQuantity,
  })
}

watch(
  () => props.trainers,
  (trainers) => {
    if (trainers.some((trainer) => trainer.slug === selectedTrainerSlug.value)) return
    selectedTrainerSlug.value = trainers[0]?.slug ?? ''
  },
)

watch(
  () => [selectedTrainerSlug.value, props.sectionKey] as const,
  () => {
    selectedTrainerRowIndex.value = 0
    clampQuantity()
  },
)

watch(maxQuantity, clampQuantity)
watch(() => props.direction, clampQuantity)
</script>

<template>
  <div class="group-transfer-dialog-backdrop" role="presentation">
    <section
      class="group-transfer-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-transfer-dialog-title"
    >
      <header class="group-transfer-dialog__header">
        <div>
          <p class="group-transfer-dialog__eyebrow">Inventory transfer</p>
          <h3 id="group-transfer-dialog-title">{{ dialogTitle }}</h3>
          <p>
            Transfers are saved by the server before this page updates. Equipment moves as a whole row.
          </p>
        </div>
        <button type="button" class="group-transfer-dialog__close" aria-label="Close transfer dialog" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="group-transfer-dialog__body">
        <label class="group-transfer-dialog__field">
          <span>Trainer</span>
          <select v-model="selectedTrainerSlug" :disabled="isBusy">
            <option v-for="trainer in trainers" :key="trainer.slug" :value="trainer.slug">
              {{ trainer.name }} · rev {{ trainer.revision }}
            </option>
          </select>
        </label>

        <label v-if="direction === 'trainer-to-group'" class="group-transfer-dialog__field">
          <span>Trainer row</span>
          <select v-model.number="selectedTrainerRowIndex" :disabled="isBusy || !hasTrainerRows">
            <option v-for="(row, index) in trainerRows" :key="`${index}:${row.name}`" :value="index">
              {{ displayItemName(row) }}<template v-if="!isEquipmentTransfer"> · qty {{ row.qty ?? 0 }}</template>
            </option>
          </select>
        </label>

        <dl class="group-transfer-dialog__summary">
          <div>
            <dt>Section</dt>
            <dd>{{ section.title }}</dd>
          </div>
          <div>
            <dt>Item</dt>
            <dd>{{ sourceItemName }}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{{ isEquipmentTransfer ? 'Whole row' : maxQuantity }}</dd>
          </div>
        </dl>

        <label v-if="!isEquipmentTransfer" class="group-transfer-dialog__field">
          <span>Quantity</span>
          <input
            :value="quantity"
            type="number"
            min="1"
            :max="Math.max(1, maxQuantity)"
            step="1"
            inputmode="numeric"
            :disabled="isBusy"
            @input="setQuantity"
          >
        </label>
        <p v-else class="group-transfer-dialog__hint">Equipment transfers always move the selected row as a whole item.</p>

        <p v-if="validationMessage" class="group-transfer-dialog__message" role="alert">
          {{ validationMessage }}
        </p>
        <p v-else-if="error" class="group-transfer-dialog__message group-transfer-dialog__message--error" role="alert">
          {{ error }}
        </p>
      </div>

      <footer class="group-transfer-dialog__actions">
        <button type="button" class="group-transfer-dialog__secondary" :disabled="isBusy" @click="emit('close')">
          Cancel
        </button>
        <button type="button" class="group-transfer-dialog__primary" :disabled="submitDisabled" @click="submit">
          {{ submitLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.group-transfer-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.48);
}

.group-transfer-dialog {
  width: min(100%, 34rem);
  display: grid;
  gap: 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background: var(--paper);
  box-shadow: 0 1.4rem 3rem rgba(0, 0, 0, 0.35);
  padding: 1rem;
}

.group-transfer-dialog__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.group-transfer-dialog__header p,
.group-transfer-dialog__hint,
.group-transfer-dialog__message {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.5;
}

.group-transfer-dialog__eyebrow {
  color: var(--accent) !important;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.group-transfer-dialog h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.35rem;
}

.group-transfer-dialog__close {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-inset);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-size: 1.35rem;
  line-height: 1;
}

.group-transfer-dialog__body {
  display: grid;
  gap: 0.85rem;
}

.group-transfer-dialog__field {
  display: grid;
  gap: 0.35rem;
  color: var(--ink-bright);
  font-weight: 800;
}

.group-transfer-dialog__field select,
.group-transfer-dialog__field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  color: var(--ink-bright);
  font: inherit;
  padding: 0.55rem 0.65rem;
}

.group-transfer-dialog__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.group-transfer-dialog__summary div {
  display: grid;
  gap: 0.2rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
  padding: 0.55rem 0.65rem;
}

.group-transfer-dialog__summary dt {
  color: var(--ink-muted);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.group-transfer-dialog__summary dd {
  margin: 0;
  color: var(--ink-bright);
  font-weight: 900;
}

.group-transfer-dialog__message {
  border: 1px solid color-mix(in srgb, var(--bad) 55%, var(--rule-soft));
  border-radius: 10px;
  background: rgba(150, 40, 40, 0.12);
  color: var(--bad, #ffb3b3);
  padding: 0.65rem 0.75rem;
}

.group-transfer-dialog__message--error {
  color: var(--bad, #ffb3b3);
}

.group-transfer-dialog__actions {
  display: flex;
  justify-content: end;
  gap: 0.5rem;
}

.group-transfer-dialog__primary,
.group-transfer-dialog__secondary {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  padding: 0.55rem 0.85rem;
  text-transform: uppercase;
}

.group-transfer-dialog__primary {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--rule-soft));
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--ink-bright);
}

.group-transfer-dialog__secondary {
  background: var(--paper-inset);
  color: var(--ink-soft);
}

.group-transfer-dialog__primary:hover:not(:disabled),
.group-transfer-dialog__primary:focus-visible:not(:disabled),
.group-transfer-dialog__secondary:hover:not(:disabled),
.group-transfer-dialog__secondary:focus-visible:not(:disabled),
.group-transfer-dialog__close:hover,
.group-transfer-dialog__close:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.group-transfer-dialog__primary:disabled,
.group-transfer-dialog__secondary:disabled,
.group-transfer-dialog__field select:disabled,
.group-transfer-dialog__field input:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

@media (max-width: 640px) {
  .group-transfer-dialog__summary {
    grid-template-columns: 1fr;
  }
}
</style>
