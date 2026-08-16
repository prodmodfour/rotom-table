<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { findItem } from '~~/data/ptuReference'
import { ptuItemOptionDetail } from '~/utils/reference/itemOptions'
import type { TrainerInventoryItemOption } from '~/utils/sheets/trainerInventoryItems'

const props = withDefaults(defineProps<{
  modelValue: string
  options: readonly TrainerInventoryItemOption[]
  placeholder?: string
}>(), {
  placeholder: 'Item',
})

const emit = defineEmits<{
  commit: [value: string]
}>()

const editing = ref(false)
const draft = ref('')
const displayButton = ref<HTMLButtonElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const listId = useId()

const normalizedValue = computed(() => props.modelValue?.trim() ?? '')
const referenceItem = computed(() => normalizedValue.value ? findItem(normalizedValue.value) : null)
const displayLabel = computed(() => referenceItem.value?.name ?? normalizedValue.value)
const isEmpty = computed(() => !displayLabel.value)
const displayText = computed(() => displayLabel.value || props.placeholder)
const editLabel = computed(() => `Edit item name: ${displayText.value}`)
const displayTitle = computed(() => {
  if (!referenceItem.value) return displayText.value
  const detail = ptuItemOptionDetail(referenceItem.value)
  return detail ? `${referenceItem.value.name} — ${detail}` : referenceItem.value.name
})

const focusInput = async () => {
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

const beginEdit = () => {
  if (editing.value) return
  draft.value = normalizedValue.value
  editing.value = true
  void focusInput()
}

const restoreDisplayFocus = async (): Promise<void> => {
  await nextTick()
  displayButton.value?.focus()
}
const commit = (restoreFocus = false) => {
  if (!editing.value) return
  editing.value = false
  emit('commit', draft.value)
  if (restoreFocus) void restoreDisplayFocus()
}

const cancel = (restoreFocus = false) => {
  editing.value = false
  draft.value = normalizedValue.value
  if (restoreFocus) void restoreDisplayFocus()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel(true)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    commit(true)
  }
}
</script>

<template>
  <span class="inventory-name-cell" :class="{ 'inventory-name-cell--editing': editing }">
    <button
      v-if="!editing"
      ref="displayButton"
      type="button"
      class="inventory-name-cell__display"
      :class="{ 'inventory-name-cell__display--empty': isEmpty }"
      :title="displayTitle"
      :aria-label="editLabel"
      @click="beginEdit"
    >
      <ItemSprite v-if="referenceItem" :item="referenceItem" size="sm" />
      <span v-else class="inventory-name-cell__sprite-placeholder" aria-hidden="true">—</span>
      <span class="inventory-name-cell__label">{{ displayText }}</span>
    </button>

    <span v-else class="inventory-name-cell__editor-wrap">
      <input
        ref="inputEl"
        v-model="draft"
        class="inventory-name-cell__input"
        type="text"
        :list="listId"
        :placeholder="placeholder"
        :aria-label="`Item name, current value ${displayText}`"
        autocomplete="off"
        @blur="commit(false)"
        @keydown="onKeydown"
      />
      <datalist :id="listId">
        <option
          v-for="option in options"
          :key="option.value"
          :value="option.value"
          :label="option.label"
        />
      </datalist>
    </span>
  </span>
</template>

<style scoped>
.inventory-name-cell {
  display: flex;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.inventory-name-cell--editing,
.inventory-name-cell__editor-wrap {
  width: 100%;
}

.inventory-name-cell__display {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  max-width: 100%;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  padding: 0.05em 0.25em;
  margin: -0.05em -0.25em;
  font: inherit;
  font-weight: inherit;
  text-align: left;
  cursor: text;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;
}

.inventory-name-cell__display:hover {
  background: rgba(var(--accent-rgb), 0.08);
  box-shadow: inset 0 -1px 0 rgba(var(--accent-rgb), 0.45);
}

.inventory-name-cell__display:focus-visible {
  background: rgba(var(--accent-rgb), 0.08);
  outline: 2px solid var(--rt-focus, var(--accent));
  outline-offset: 2px;
}

.inventory-name-cell__display--empty {
  color: var(--ink-faint, #66707a);
  font-style: italic;
}

.inventory-name-cell__sprite-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--ink-faint, #66707a);
  font-size: 0.78rem;
  font-style: normal;
}

.inventory-name-cell__label {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.inventory-name-cell__input {
  width: 100%;
  min-width: 9rem;
  min-height: 2.75rem;
  border: 1px solid var(--accent, #ff1f2d);
  border-radius: 4px;
  background: var(--paper, #fff);
  color: inherit;
  padding: 0.1em 0.35em;
  font: inherit;
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.18);
}

.inventory-name-cell__input:focus-visible {
  border-color: var(--rt-focus, var(--accent));
  outline: 2px solid var(--rt-focus, var(--accent));
  outline-offset: 2px;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .inventory-name-cell__display { transition: none; }
}
</style>
