<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ConditionTagSize } from '~/utils/conditionTagArt'
import { addAppliedCondition } from '~/utils/conditionApplication'
import {
  conditionBaseName,
  conditionDisplayName,
  conditionGroups,
  conditionTitle,
  disabledConditionMove,
  formatDisabledCondition,
  formatInfatuationCondition,
  infatuationCrushName,
  isStackableCondition,
  normalizeConditionNames,
} from '~/utils/statusConditions'

const CUSTOM_MOVE_VALUE = '__custom-disabled-move__'
const CUSTOM_INFATUATION_CRUSH_VALUE = '__custom-infatuation-crush__'

const props = withDefaults(defineProps<{
  modelValue?: string[]
  disabled?: boolean
  compact?: boolean
  tagSize?: ConditionTagSize
  availableMoves?: string[]
  availableCrushes?: string[]
}>(), {
  modelValue: () => [],
  disabled: false,
  compact: false,
  tagSize: 'sm',
  availableMoves: () => [],
  availableCrushes: () => [],
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const selected = computed(() => normalizeConditionNames(props.modelValue))
const selectedSet = computed(() => new Set(selected.value))
const selectedBaseSet = computed(() => new Set(
  selected.value.map((condition) => conditionBaseName(condition) ?? condition),
))
const uniqueNormalizedOptions = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ')
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

const moveOptions = computed(() => uniqueNormalizedOptions(props.availableMoves))
const crushOptions = computed(() => uniqueNormalizedOptions(props.availableCrushes))

const disabledMovePickerOpen = ref(false)
const disabledMoveChoice = ref('')
const disabledCustomMove = ref('')
const infatuationPickerOpen = ref(false)
const infatuationChoice = ref('')
const infatuationCustomCrush = ref('')

const update = (value: string[]) => {
  if (props.disabled) return
  emit('update:modelValue', normalizeConditionNames(value))
}

const isDisabledCondition = (name: string) => conditionBaseName(name) === 'Disabled'
const isInfatuationCondition = (name: string) => conditionBaseName(name) === 'Infatuation'
const conditionDetail = (name: string): string | null => disabledConditionMove(name) ?? infatuationCrushName(name)
const activeConditionLabel = (name: string): string => conditionDetail(name) ?? conditionDisplayName(name)
const conditionsWithoutBase = (baseName: string): string[] =>
  selected.value.filter((condition) => conditionBaseName(condition) !== baseName)

const resetDisabledMovePicker = () => {
  disabledMoveChoice.value = ''
  disabledCustomMove.value = ''
}

const resetInfatuationPicker = () => {
  infatuationChoice.value = ''
  infatuationCustomCrush.value = ''
}

const openDisabledMovePicker = () => {
  if (props.disabled) return
  if (infatuationPickerOpen.value) closeInfatuationPicker()
  disabledMovePickerOpen.value = true
  if (!disabledMoveChoice.value && moveOptions.value.length) disabledMoveChoice.value = moveOptions.value[0]
}

const openInfatuationPicker = () => {
  if (props.disabled) return
  if (disabledMovePickerOpen.value) closeDisabledMovePicker()
  infatuationPickerOpen.value = true
  if (!infatuationChoice.value && crushOptions.value.length) infatuationChoice.value = crushOptions.value[0]
}

const closeDisabledMovePicker = () => {
  disabledMovePickerOpen.value = false
  resetDisabledMovePicker()
}

const closeInfatuationPicker = () => {
  infatuationPickerOpen.value = false
  resetInfatuationPicker()
}

const selectedDisabledMove = computed(() => {
  if (!moveOptions.value.length || disabledMoveChoice.value === CUSTOM_MOVE_VALUE) {
    return disabledCustomMove.value.trim().replace(/\s+/g, ' ')
  }
  return disabledMoveChoice.value.trim().replace(/\s+/g, ' ')
})

const selectedInfatuationCrush = computed(() => {
  if (!crushOptions.value.length || infatuationChoice.value === CUSTOM_INFATUATION_CRUSH_VALUE) {
    return infatuationCustomCrush.value.trim().replace(/\s+/g, ' ')
  }
  return infatuationChoice.value.trim().replace(/\s+/g, ' ')
})

const addDisabledMove = () => {
  if (props.disabled) return
  const moveName = selectedDisabledMove.value
  if (!moveName) return
  update(addAppliedCondition(selected.value, formatDisabledCondition(moveName)))
  closeDisabledMovePicker()
}

const addInfatuation = () => {
  if (props.disabled) return
  const crushName = selectedInfatuationCrush.value
  const condition = crushName ? formatInfatuationCondition(crushName) : 'Infatuation'
  update(addAppliedCondition(conditionsWithoutBase('Infatuation'), condition))
  closeInfatuationPicker()
}

const removeCondition = (name: string, index: number) => {
  if (isStackableCondition(name)) {
    update(selected.value.filter((_, conditionIndex) => conditionIndex !== index))
    return
  }

  update(selected.value.filter((condition) => condition !== name))
}

const toggle = (name: string) => {
  if (isDisabledCondition(name)) {
    openDisabledMovePicker()
    return
  }

  if (isInfatuationCondition(name)) {
    if (selectedBaseSet.value.has('Infatuation')) update(conditionsWithoutBase('Infatuation'))
    else openInfatuationPicker()
    return
  }

  if (isStackableCondition(name)) {
    update(addAppliedCondition(selected.value, name))
    return
  }

  const next = selected.value.filter((condition) => condition !== name)
  if (!selectedSet.value.has(name)) update(addAppliedCondition(next, name))
  else update(next)
}

const optionSelected = (name: string): boolean => {
  if (isDisabledCondition(name)) return selectedBaseSet.value.has('Disabled')
  if (isInfatuationCondition(name)) return selectedBaseSet.value.has('Infatuation')
  return selectedSet.value.has(name)
}

const conditionOptionTitle = (name: string): string => {
  if (isDisabledCondition(name)) return 'Add Disabled and choose a Move'
  if (isInfatuationCondition(name)) return 'Add Infatuation and choose the crush'
  return conditionTitle(name)
}

const conditionOptionHasDetailPicker = (name: string): boolean =>
  isDisabledCondition(name) || isInfatuationCondition(name)

const clear = () => update([])

watch(moveOptions, (options) => {
  if (!options.length) {
    if (disabledMoveChoice.value !== CUSTOM_MOVE_VALUE) disabledMoveChoice.value = ''
    return
  }
  if (!options.includes(disabledMoveChoice.value) && disabledMoveChoice.value !== CUSTOM_MOVE_VALUE) {
    disabledMoveChoice.value = options[0]
  }
})

watch(crushOptions, (options) => {
  if (!options.length) {
    if (infatuationChoice.value !== CUSTOM_INFATUATION_CRUSH_VALUE) infatuationChoice.value = ''
    return
  }
  if (!options.includes(infatuationChoice.value) && infatuationChoice.value !== CUSTOM_INFATUATION_CRUSH_VALUE) {
    infatuationChoice.value = options[0]
  }
})
</script>

<template>
  <div class="condition-picker" :class="{ 'condition-picker--compact': compact }">
    <div v-if="selected.length" class="condition-picker__active" aria-label="Applied conditions">
      <button
        v-for="(name, index) in selected"
        :key="`${name}-${index}`"
        type="button"
        class="condition-picker__active-tag"
        :title="`Remove ${conditionDisplayName(name)}`"
        :disabled="disabled"
        @click="removeCondition(name, index)"
      >
        <ConditionTag :name="name" :size="tagSize" />
        <span v-if="conditionDetail(name)" class="condition-picker__active-detail">{{ activeConditionLabel(name) }}</span>
        <span aria-hidden="true" class="condition-picker__remove">×</span>
        <span class="sr-only">Remove {{ conditionDisplayName(name) }}</span>
      </button>
      <button
        type="button"
        class="condition-picker__clear"
        :disabled="disabled"
        @click="clear"
      >
        Clear all
      </button>
    </div>

    <p v-else class="condition-picker__empty">No conditions applied.</p>

    <div
      v-if="disabledMovePickerOpen"
      class="condition-picker__detail-picker"
      @keydown.enter.prevent="addDisabledMove"
    >
      <label>
        <span>Move to disable</span>
        <select
          v-if="moveOptions.length"
          v-model="disabledMoveChoice"
          :disabled="disabled"
        >
          <option v-for="move in moveOptions" :key="move" :value="move">{{ move }}</option>
          <option :value="CUSTOM_MOVE_VALUE">Custom move…</option>
        </select>
        <input
          v-if="!moveOptions.length || disabledMoveChoice === CUSTOM_MOVE_VALUE"
          v-model.trim="disabledCustomMove"
          :disabled="disabled"
          type="text"
          placeholder="Move name…"
        >
      </label>
      <div class="condition-picker__detail-actions">
        <button
          type="button"
          class="condition-picker__detail-button condition-picker__detail-button--primary"
          :disabled="disabled || !selectedDisabledMove"
          @click="addDisabledMove"
        >
          Disable move
        </button>
        <button
          type="button"
          class="condition-picker__detail-button"
          :disabled="disabled"
          @click="closeDisabledMovePicker"
        >
          Cancel
        </button>
      </div>
    </div>

    <div
      v-if="infatuationPickerOpen"
      class="condition-picker__detail-picker"
      @keydown.enter.prevent="addInfatuation"
    >
      <label>
        <span>Infatuation crush</span>
        <select
          v-if="crushOptions.length"
          v-model="infatuationChoice"
          :disabled="disabled"
        >
          <option v-for="crush in crushOptions" :key="crush" :value="crush">{{ crush }}</option>
          <option :value="CUSTOM_INFATUATION_CRUSH_VALUE">Custom crush…</option>
        </select>
        <input
          v-if="!crushOptions.length || infatuationChoice === CUSTOM_INFATUATION_CRUSH_VALUE"
          v-model.trim="infatuationCustomCrush"
          :disabled="disabled"
          type="text"
          placeholder="Crush name…"
        >
      </label>
      <p class="condition-picker__detail-note">Choose the crush for damage automation; leave blank to track the condition only.</p>
      <div class="condition-picker__detail-actions">
        <button
          type="button"
          class="condition-picker__detail-button condition-picker__detail-button--primary"
          :disabled="disabled"
          @click="addInfatuation"
        >
          Apply Infatuation
        </button>
        <button
          type="button"
          class="condition-picker__detail-button"
          :disabled="disabled"
          @click="closeInfatuationPicker"
        >
          Cancel
        </button>
      </div>
    </div>

    <div class="condition-picker__groups">
      <section
        v-for="group in conditionGroups"
        :key="group.category"
        class="condition-picker__group"
      >
        <h4>{{ group.label }}</h4>
        <div class="condition-picker__options">
          <button
            v-for="condition in group.conditions"
            :key="condition.name"
            type="button"
            class="condition-picker__option"
            :class="{ 'is-selected': optionSelected(condition.name) }"
            :aria-pressed="optionSelected(condition.name)"
            :title="conditionOptionTitle(condition.name)"
            :disabled="disabled"
            @click="toggle(condition.name)"
          >
            <ConditionTag :name="condition.name" :size="tagSize" />
            <span v-if="!compact" class="condition-picker__option-name">{{ condition.name }}</span>
            <span v-if="conditionOptionHasDetailPicker(condition.name)" class="condition-picker__option-action">+</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.condition-picker {
  display: grid;
  gap: 0.75rem;
}

.condition-picker__active {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.condition-picker__active-tag,
.condition-picker__clear,
.condition-picker__option {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: rgba(60, 56, 54, 0.36);
  color: var(--ink);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease, transform 0.14s ease;
}

.condition-picker__active-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.42rem 0.18rem 0.2rem;
}

.condition-picker__active-tag:hover:not(:disabled),
.condition-picker__option:hover:not(:disabled),
.condition-picker__clear:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-1px);
}

.condition-picker__active-detail {
  max-width: 11rem;
  overflow: hidden;
  color: var(--ink-bright);
  font-size: 0.76rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.condition-picker__remove {
  color: var(--ink-soft);
  font-weight: 900;
  line-height: 1;
}

.condition-picker__clear {
  padding: 0.34rem 0.65rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.condition-picker__empty {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.9rem;
}

.condition-picker__groups {
  display: grid;
  gap: 0.65rem;
}

.condition-picker__group {
  display: grid;
  gap: 0.4rem;
}

.condition-picker__group h4 {
  margin: 0;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.condition-picker__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.condition-picker__detail-picker {
  display: grid;
  gap: 0.55rem;
  padding: 0.62rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
}

.condition-picker__detail-picker label {
  display: grid;
  gap: 0.32rem;
  color: var(--ink-soft);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.condition-picker__detail-picker select,
.condition-picker__detail-picker input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.48rem 0.58rem;
  font: inherit;
  letter-spacing: normal;
  text-transform: none;
}

.condition-picker__detail-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.76rem;
}

.condition-picker__detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.condition-picker__detail-button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: rgba(60, 56, 54, 0.36);
  color: var(--ink);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 0.76rem;
  font-weight: 800;
  padding: 0.36rem 0.62rem;
}

.condition-picker__detail-button--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.condition-picker__option {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding: 0.22rem 0.48rem 0.22rem 0.22rem;
}

.condition-picker__option.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink-bright);
}

.condition-picker__option-name {
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}

.condition-picker__option-action {
  color: var(--ink-muted);
  font-size: 0.82rem;
  font-weight: 900;
  line-height: 1;
}

.condition-picker--compact {
  gap: 0.55rem;
}

.condition-picker--compact .condition-picker__groups {
  gap: 0.5rem;
}

.condition-picker--compact .condition-picker__option {
  padding: 0.18rem;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
