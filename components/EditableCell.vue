<script setup lang="ts">
/**
 * EditableCell — a tiny "spreadsheet cell" component.
 *
 *   <EditableCell v-model="sheet.level" type="number" />
 *   <EditableCell v-model="sheet.nickname" placeholder="Nickname" />
 *   <EditableCell v-model="move.effect" type="textarea" />
 *   <EditableCell v-model="sheet.gender" type="select" :options="['Male', 'Female']" />
 *
 * Click the value → swap to an inline editor. Commit on Enter or blur,
 * cancel on Escape. The component holds local draft state so a half-typed
 * value doesn't flood the parent watcher (and the auto-save with it).
 *
 * For ``type="number"`` empty input commits as ``undefined`` so the field
 * is dropped from the JSON, mirroring how the renderer handles missing
 * numeric values (em-dash / 0 fallback).
 */
import { computed, nextTick, ref } from 'vue'

type CellValue = string | number | boolean | null | undefined

interface Props {
  modelValue: CellValue
  type?: 'text' | 'number' | 'textarea' | 'select'
  /** Hint shown when the value is empty. */
  placeholder?: string
  /** For ``type="select"``. Empty string is treated as "no value". */
  options?: Array<string | { value: string; label: string }>
  /** Disable editing — render value as plain text. */
  readonly?: boolean
  /** Optional formatter applied to the displayed value (not the editor). */
  format?: (value: CellValue) => string
  /** Display when the value is null/undefined/empty. Defaults to em-dash. */
  emptyText?: string
  /** Min/max for numeric inputs. */
  min?: number
  max?: number
  /** Force commit on every keystroke (for sliders / ranges). Default false. */
  commitOnInput?: boolean
  /** Allow displayed value to wrap onto multiple lines. */
  multiline?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: '',
  options: () => [],
  readonly: false,
  format: undefined,
  emptyText: '—',
  min: undefined,
  max: undefined,
  commitOnInput: false,
  multiline: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: CellValue): void
  (e: 'commit', value: CellValue): void
}>()

const editing = ref(false)
const draft = ref<string>('')
// Guards against the blur handler re-firing commit after Enter has already
// committed and the input is being torn down. Without this, an empty draft
// from the watcher reset would clobber the value we just emitted.
let committedThisSession = false
const inputEl = ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)

const isEmpty = (v: CellValue): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v === '')

const displayValue = computed<string>(() => {
  if (props.format) return props.format(props.modelValue)
  if (isEmpty(props.modelValue)) return ''
  return String(props.modelValue)
})

const optionsResolved = computed(() =>
  props.options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  ),
)

const beginEdit = async () => {
  if (props.readonly) return
  draft.value = isEmpty(props.modelValue) ? '' : String(props.modelValue)
  committedThisSession = false
  editing.value = true
  await nextTick()
  const el = inputEl.value
  if (el) {
    el.focus()
    if ('select' in el && typeof (el as HTMLInputElement).select === 'function') {
      ;(el as HTMLInputElement).select()
    }
  }
}

/** Convert the local draft string into the value we emit. */
const parseDraft = (raw: string): CellValue => {
  if (props.type === 'number') {
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return props.modelValue
    if (props.min != null && n < props.min) return props.min
    if (props.max != null && n > props.max) return props.max
    return n
  }
  return raw
}

const commit = () => {
  if (committedThisSession) {
    editing.value = false
    return
  }
  committedThisSession = true
  const next = parseDraft(draft.value)
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
    emit('commit', next)
  }
  editing.value = false
}

const cancel = () => {
  committedThisSession = true
  editing.value = false
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
    return
  }
  if (e.key === 'Enter' && props.type !== 'textarea') {
    e.preventDefault()
    commit()
    return
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && props.type === 'textarea') {
    e.preventDefault()
    commit()
  }
}

// For selects, the user picks an option — commit immediately (no blur dance).
const onSelectChange = (e: Event) => {
  const value = (e.target as HTMLSelectElement).value
  draft.value = value
  commit()
}

const onInput = (e: Event) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement
  draft.value = target.value
  if (props.commitOnInput) commit()
}

// External modelValue changes during display are picked up automatically by
// the displayValue computed. We don't reset draft here — beginEdit() always
// reinitialises it when entering edit mode, and resetting while editing
// would race with a still-mounted input's blur handler.
</script>

<template>
  <span
    class="editable-cell"
    :class="{
      'editable-cell--editing': editing,
      'editable-cell--readonly': readonly,
      'editable-cell--empty': isEmpty(modelValue),
      'editable-cell--multiline': multiline,
    }"
    @click="!editing && beginEdit()"
  >
    <template v-if="!editing">
      <span v-if="isEmpty(modelValue) && !displayValue" class="editable-cell__empty">
        {{ placeholder || emptyText }}
      </span>
      <span v-else class="editable-cell__display">{{ displayValue }}</span>
    </template>

    <template v-else>
      <select
        v-if="type === 'select'"
        ref="inputEl"
        :value="draft"
        class="editable-cell__input editable-cell__input--select"
        @change="onSelectChange"
        @blur="commit"
        @keydown="onKeydown"
      >
        <option value="">{{ placeholder || '—' }}</option>
        <option
          v-for="opt in optionsResolved"
          :key="opt.value"
          :value="opt.value"
        >{{ opt.label }}</option>
      </select>

      <textarea
        v-else-if="type === 'textarea'"
        ref="inputEl"
        :value="draft"
        rows="2"
        class="editable-cell__input editable-cell__input--textarea"
        :placeholder="placeholder"
        @input="onInput"
        @blur="commit"
        @keydown="onKeydown"
      />

      <input
        v-else
        ref="inputEl"
        :type="type === 'number' ? 'number' : 'text'"
        :value="draft"
        :min="type === 'number' ? min : undefined"
        :max="type === 'number' ? max : undefined"
        :placeholder="placeholder"
        class="editable-cell__input"
        @input="onInput"
        @blur="commit"
        @keydown="onKeydown"
      />
    </template>
  </span>
</template>

<style scoped>
.editable-cell {
  display: inline-flex;
  align-items: baseline;
  min-width: 1.5em;
  border-radius: 4px;
  padding: 0.05em 0.25em;
  margin: -0.05em -0.25em;
  cursor: text;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;
  position: relative;
}

.editable-cell--multiline {
  display: inline;
  white-space: pre-wrap;
}

.editable-cell:hover:not(.editable-cell--readonly):not(.editable-cell--editing) {
  background: rgba(250, 189, 47, 0.08);
  box-shadow: inset 0 -1px 0 rgba(250, 189, 47, 0.45);
}

.editable-cell--editing {
  padding: 0;
  margin: 0;
  background: transparent;
  box-shadow: none;
}

.editable-cell--readonly {
  cursor: default;
}

.editable-cell--readonly:hover {
  background: transparent;
  box-shadow: none;
}

.editable-cell__empty {
  color: var(--ink-faint, #999);
  font-style: italic;
}

.editable-cell__display {
  color: inherit;
}

.editable-cell__input {
  font: inherit;
  color: inherit;
  width: 100%;
  min-width: 4em;
  border: 1px solid var(--accent, #fabd2f);
  border-radius: 4px;
  background: var(--paper, #fff);
  padding: 0.1em 0.35em;
  outline: none;
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.editable-cell__input--textarea {
  resize: vertical;
  min-height: 2.4em;
  width: 100%;
  white-space: pre-wrap;
}

.editable-cell__input--select {
  appearance: auto;
}
</style>
