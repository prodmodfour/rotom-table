<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  EquippedItemInstanceV1,
  EquipmentActivityReasonV1,
  EquipmentActivityStatus,
} from '#shared/itemAutomation/equipment'
import { parseEquipmentDurabilityState } from '#shared/itemAutomation/equipmentDurability'
import type { TrainerEquipmentLifecycleChange } from '~/composables/sheets/useTrainerEquipmentOperations'

type LifecycleMode = TrainerEquipmentLifecycleChange['commandKind']

const props = defineProps<{
  instance: EquippedItemInstanceV1
  busy?: boolean
}>()
const emit = defineEmits<{
  cancel: []
  submit: [change: TrainerEquipmentLifecycleChange]
}>()

const selectedMode = ref<LifecycleMode>('suppress')
const amount = ref(1)
const note = ref('')

const durability = computed(() => {
  try { return parseEquipmentDurabilityState(props.instance.serializedState) }
  catch { return null }
})
const restorableReasons = computed(() => props.instance.activity.reasons.filter(reason => (
  reason.code.startsWith('equipment.suppression.') || reason.code.startsWith('equipment.inactive.')
)))
const repairableReasons = computed(() => props.instance.activity.reasons.filter(reason => (
  reason.code.startsWith('equipment.breakage.') && reason.code !== 'equipment.breakage.durability'
)))
const durabilityBroken = computed(() => props.instance.activity.reasons.some(reason => (
  reason.code === 'equipment.breakage.durability'
)))
const selectedReason = computed<EquipmentActivityReasonV1 | undefined>(() => (
  selectedMode.value === 'restore'
    ? restorableReasons.value[0]
    : selectedMode.value === 'repair'
      ? repairableReasons.value[0]
      : undefined
))

const modes = computed<readonly { id: LifecycleMode; label: string; hint: string }[]>(() => {
  const rows: { id: LifecycleMode; label: string; hint: string }[] = []
  if (durability.value && durability.value.current > 0) rows.push({
    id: 'damage', label: 'Apply durability damage', hint: 'Subtract reviewed item HP.',
  })
  if (durability.value && durability.value.current < durability.value.maximum) rows.push({
    id: 'restore-durability', label: 'Restore durability', hint: 'Repair reviewed item HP.',
  })
  if (restorableReasons.value.length) rows.push({
    id: 'restore', label: 'Restore activity', hint: 'Remove the exact selected suppression or inactive source.',
  })
  if (repairableReasons.value.length) rows.push({
    id: 'repair', label: 'Repair narrative break', hint: 'Remove the exact guided breakage source.',
  })
  if (props.instance.activity.status === 'active') {
    rows.push(
      { id: 'suppress', label: 'Suppress', hint: 'Withdraw mechanics while the durable source remains.' },
      { id: 'deactivate', label: 'Deactivate', hint: 'Mark this item inactive for a reviewed reason.' },
      { id: 'break', label: 'Narrative break', hint: 'Break without inventing unsupported numeric durability.' },
    )
  }
  return rows
})

const reasonKey = (reason: EquipmentActivityReasonV1): string => `${reason.code}\u001f${reason.sourceId ?? ''}`
const statusFor = (
  reasons: readonly EquipmentActivityReasonV1[],
  previous: EquipmentActivityStatus,
): EquipmentActivityStatus => {
  if (!reasons.length) return 'active'
  if (reasons.some(reason => reason.code.startsWith('equipment.breakage.'))) return 'broken'
  if (reasons.some(reason => reason.code.startsWith('equipment.inactive.') || reason.code === 'equipment.definition-pending')) return 'inactive'
  if (reasons.some(reason => reason.code.startsWith('equipment.suppression.'))) return 'suppressed'
  return previous === 'active' ? 'inactive' : previous
}
const boundedAmount = computed(() => {
  const value = Number(amount.value)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
})
const maximumAmount = computed(() => {
  if (!durability.value) return 0
  return selectedMode.value === 'damage'
    ? durability.value.current
    : durability.value.maximum - durability.value.current
})
const previewDurability = computed(() => {
  if (!durability.value || !['damage', 'restore-durability'].includes(selectedMode.value)) return null
  return selectedMode.value === 'damage'
    ? Math.max(0, durability.value.current - boundedAmount.value)
    : Math.min(durability.value.maximum, durability.value.current + boundedAmount.value)
})
const previewStatus = computed<EquipmentActivityStatus>(() => {
  if (selectedMode.value === 'suppress') return 'suppressed'
  if (selectedMode.value === 'deactivate') return 'inactive'
  if (selectedMode.value === 'break') return 'broken'
  let reasons = [...props.instance.activity.reasons]
  if (selectedMode.value === 'restore' || selectedMode.value === 'repair') {
    const selected = selectedReason.value
    if (selected) reasons = reasons.filter(reason => reasonKey(reason) !== reasonKey(selected))
  }
  if (selectedMode.value === 'damage' && previewDurability.value === 0 && !durabilityBroken.value) {
    reasons.push({ code: 'equipment.breakage.durability', sourceId: props.instance.instanceId })
  }
  if (selectedMode.value === 'restore-durability' && previewDurability.value !== 0) {
    reasons = reasons.filter(reason => reason.code !== 'equipment.breakage.durability')
  }
  return statusFor(reasons, props.instance.activity.status)
})
const amountRequired = computed(() => selectedMode.value === 'damage' || selectedMode.value === 'restore-durability')
const canSubmit = computed(() => !props.busy
  && note.value.trim().length > 0
  && (!amountRequired.value || (boundedAmount.value > 0 && boundedAmount.value <= maximumAmount.value))
  && (selectedMode.value !== 'restore' && selectedMode.value !== 'repair' || Boolean(selectedReason.value)))
const commitLabel = computed(() => {
  if (selectedMode.value === 'damage') return `Apply ${boundedAmount.value || ''} damage`.trim()
  if (selectedMode.value === 'restore-durability') return `Restore ${boundedAmount.value || ''} HP`.trim()
  return ({
    suppress: 'Suppress item',
    deactivate: 'Deactivate item',
    break: 'Mark broken',
    restore: 'Restore activity',
    repair: 'Repair item',
    damage: 'Apply damage',
    'restore-durability': 'Restore durability',
  } as const)[selectedMode.value]
})
const statusLabel = (status: EquipmentActivityStatus): string => status === 'inactive'
  ? 'Inactive'
  : `${status[0]!.toUpperCase()}${status.slice(1)}`

watch(
  () => [props.instance.instanceId, props.instance.revision, modes.value.map(mode => mode.id).join(':')] as const,
  () => {
    const available = new Set(modes.value.map(mode => mode.id))
    const preferred: LifecycleMode = props.instance.activity.status === 'broken'
      ? durabilityBroken.value ? 'restore-durability' : 'repair'
      : props.instance.activity.status === 'suppressed' || props.instance.activity.status === 'inactive'
        ? 'restore'
        : durability.value ? 'damage' : 'suppress'
    selectedMode.value = available.has(preferred) ? preferred : modes.value[0]?.id ?? 'suppress'
    amount.value = 1
  },
  { immediate: true },
)

const submit = () => {
  if (!canSubmit.value) return
  emit('submit', {
    instanceId: props.instance.instanceId,
    commandKind: selectedMode.value,
    amount: amountRequired.value ? boundedAmount.value : undefined,
    reason: selectedReason.value
      ? { code: selectedReason.value.code, sourceId: selectedReason.value.sourceId }
      : undefined,
    note: note.value.trim(),
  })
}
</script>

<template>
  <aside class="equipment-lifecycle" aria-labelledby="equipment-lifecycle-title">
    <header class="equipment-lifecycle__header">
      <p>GM adjudication</p>
      <h2 id="equipment-lifecycle-title">Equipment lifecycle</h2>
      <strong>{{ instance.canonicalItemId }}</strong>
      <div class="equipment-lifecycle__current">
        <span class="equipment-lifecycle__status">{{ statusLabel(instance.activity.status) }}</span>
        <span v-if="durability" class="equipment-lifecycle__durability">
          Durability <b>{{ durability.current }} / {{ durability.maximum }} HP</b>
        </span>
      </div>
      <progress
        v-if="durability"
        :value="durability.current"
        :max="durability.maximum"
        :aria-label="`${instance.canonicalItemId} durability: ${durability.current} of ${durability.maximum} HP`"
      />
    </header>

    <fieldset class="equipment-lifecycle__modes">
      <legend>Choose one change</legend>
      <label
        v-for="mode in modes"
        :key="mode.id"
        class="equipment-lifecycle__mode"
        :class="{ 'equipment-lifecycle__mode--selected': selectedMode === mode.id }"
      >
        <input v-model="selectedMode" type="radio" name="equipment-lifecycle-mode" :value="mode.id">
        <span>
          <strong>{{ mode.label }}</strong>
          <small>{{ mode.hint }}</small>
        </span>
      </label>
    </fieldset>

    <div v-if="amountRequired" class="equipment-lifecycle__field">
      <label for="equipment-lifecycle-amount">
        {{ selectedMode === 'damage' ? 'Damage amount' : 'Durability restored' }}
      </label>
      <input
        id="equipment-lifecycle-amount"
        v-model.number="amount"
        type="number"
        inputmode="numeric"
        min="1"
        :max="maximumAmount"
        step="1"
      >
    </div>

    <div class="equipment-lifecycle__preview" role="status" aria-live="polite">
      <template v-if="durability && previewDurability !== null">
        <strong>{{ durability.current }} → {{ previewDurability }} HP</strong>
        <span>{{ previewStatus === instance.activity.status ? `Remains ${statusLabel(previewStatus)}` : `Becomes ${statusLabel(previewStatus)}` }}</span>
      </template>
      <template v-else>
        <strong>{{ statusLabel(instance.activity.status) }} → {{ statusLabel(previewStatus) }}</strong>
        <span>Current mechanics withdraw or restore only after server acceptance.</span>
      </template>
    </div>

    <div class="equipment-lifecycle__field equipment-lifecycle__field--note">
      <label for="equipment-lifecycle-note">Evidence note</label>
      <textarea
        id="equipment-lifecycle-note"
        v-model="note"
        rows="3"
        maxlength="200"
        placeholder="What accepted event or adjudication supports this change?"
      />
      <small>Evidence only. Notes never define mechanics.</small>
    </div>

    <p class="equipment-lifecycle__boundary">No change until accepted.</p>
    <footer>
      <button type="button" class="equipment-lifecycle__cancel" :disabled="busy" @click="emit('cancel')">Cancel</button>
      <button type="button" class="equipment-lifecycle__commit" :disabled="!canSubmit" @click="submit">
        {{ busy ? 'Applying…' : commitLabel }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.equipment-lifecycle {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 1rem;
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 1.1rem 1.1rem 1rem 1.3rem;
}
.equipment-lifecycle::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent);
  content: '';
}
.equipment-lifecycle__header { display: grid; gap: 0.3rem; }
.equipment-lifecycle__header p,
.equipment-lifecycle__header h2 { margin: 0; }
.equipment-lifecycle__header p {
  color: var(--accent);
  font-size: 0.69rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.equipment-lifecycle__header h2 { color: var(--ink-soft); font-size: 0.9rem; font-weight: 650; }
.equipment-lifecycle__header > strong { color: var(--ink-bright); font-family: var(--font-book); font-size: 1.55rem; }
.equipment-lifecycle__current { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.8rem; color: var(--ink-muted); font-size: 0.78rem; }
.equipment-lifecycle__status { border: 1px solid var(--rule-active); border-radius: 999px; padding: 0.15rem 0.42rem; color: var(--accent); font-weight: 700; text-transform: uppercase; }
.equipment-lifecycle__durability b { color: var(--ink-bright); font-variant-numeric: tabular-nums; }
.equipment-lifecycle progress { width: 100%; height: 0.5rem; accent-color: var(--accent); }
.equipment-lifecycle__modes { display: grid; gap: 0.4rem; margin: 0; border: 0; padding: 0; }
.equipment-lifecycle__modes legend,
.equipment-lifecycle__field label { margin-bottom: 0.35rem; color: var(--ink-soft); font-size: 0.78rem; font-weight: 700; }
.equipment-lifecycle__mode { display: flex; min-height: 3rem; cursor: pointer; align-items: center; gap: 0.6rem; border: 1px solid var(--rule-soft); border-radius: 7px; background: var(--paper-soft); padding: 0.48rem 0.6rem; }
.equipment-lifecycle__mode--selected { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.equipment-lifecycle__mode input { width: 1rem; height: 1rem; accent-color: var(--accent); }
.equipment-lifecycle__mode span { display: grid; gap: 0.08rem; }
.equipment-lifecycle__mode strong { color: var(--ink-bright); font-size: 0.82rem; }
.equipment-lifecycle__mode small,
.equipment-lifecycle__field small { color: var(--ink-muted); font-size: 0.7rem; line-height: 1.35; }
.equipment-lifecycle__field { display: grid; }
.equipment-lifecycle__field input,
.equipment-lifecycle__field textarea { width: 100%; border: 1px solid var(--rule-soft); border-radius: 7px; background: var(--paper-soft); color: var(--ink-bright); padding: 0.55rem 0.65rem; font: inherit; box-sizing: border-box; }
.equipment-lifecycle__field input { max-width: 8rem; font-variant-numeric: tabular-nums; }
.equipment-lifecycle__field textarea { resize: vertical; }
.equipment-lifecycle__field--note { gap: 0.3rem; }
.equipment-lifecycle__preview { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.35rem 0.8rem; border: 1px solid var(--warn); border-radius: 7px; background: var(--paper-soft); padding: 0.65rem 0.7rem; color: var(--warn); font-size: 0.78rem; }
.equipment-lifecycle__preview strong { color: var(--ink-bright); font-variant-numeric: tabular-nums; }
.equipment-lifecycle__boundary { margin: 0; color: var(--warn); font-size: 0.78rem; }
.equipment-lifecycle footer { display: flex; justify-content: flex-end; gap: 0.6rem; border-top: 1px solid var(--rule-soft); padding-top: 0.8rem; }
.equipment-lifecycle footer button { min-height: 2.75rem; border: 1px solid var(--rule-soft); border-radius: 7px; padding: 0.55rem 0.85rem; color: var(--ink-bright); font: inherit; font-weight: 750; cursor: pointer; }
.equipment-lifecycle__cancel { background: var(--paper-soft); }
.equipment-lifecycle__commit { border-color: var(--danger, #ff6672) !important; background: var(--danger, #c43d4a); }
.equipment-lifecycle footer button:focus-visible,
.equipment-lifecycle__mode:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.equipment-lifecycle footer button:disabled { cursor: not-allowed; opacity: 0.55; }
@media (max-width: 720px) {
  .equipment-lifecycle footer { display: grid; grid-template-columns: 1fr; }
  .equipment-lifecycle footer button { width: 100%; }
}
</style>
