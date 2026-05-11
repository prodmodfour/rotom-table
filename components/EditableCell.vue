<script setup lang="ts">
/**
 * EditableCell — a tiny "spreadsheet cell" component.
 *
 *   <EditableCell v-model="sheet.level" type="number" />
 *   <EditableCell v-model="sheet.nickname" placeholder="Nickname" />
 *   <EditableCell v-model="move.effect" type="textarea" />
 *   <EditableCell v-model="sheet.gender" type="select" :options="['Male', 'Female']" />
 *
 * Click the value → swap to an inline editor. Edits are pushed to the
 * parent as the user types (debounced by the sheet auto-save layer), then
 * finalized on Enter or blur. Escape restores the value from when editing
 * began.
 *
 * For ``type="number"`` empty input commits as ``undefined`` so the field
 * is dropped from the JSON, mirroring how the renderer handles missing
 * numeric values (em-dash / 0 fallback).
 */
import { computed, ref } from 'vue'
import {
  editableCellDraftFromValue,
  parseEditableCellDraft,
  resolveEditableCellDisplay,
  type EditableCellOption,
  type EditableCellType,
  type EditableCellValue,
} from '~/utils/editableCell'

type CellValue = EditableCellValue

interface Props {
  modelValue: CellValue
  type?: EditableCellType
  /** Hint shown when the value is empty. */
  placeholder?: string
  /** For ``type="select"``. Empty string is treated as "no value". */
  options?: readonly (string | EditableCellOption)[]
  /** Disable editing — render value as plain text. */
  readonly?: boolean
  /** Optional formatter applied to the displayed value (not the editor). */
  format?: (value: CellValue) => string
  /** Display when the value is null/undefined/empty. Defaults to em-dash. */
  emptyText?: string
  /** Min/max for numeric inputs. */
  min?: number
  max?: number
  /** Push updates to the parent on every keystroke. Disable to only commit on blur/Enter. */
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
  commitOnInput: true,
  multiline: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: CellValue): void
  (e: 'commit', value: CellValue): void
}>()

const editing = ref(false)
const draft = ref<string>('')
const sessionStartValue = ref<CellValue>(undefined)
// Guards against the blur handler re-firing commit after Enter has already
// committed and the input is being torn down. Without this, an empty draft
// from the watcher reset would clobber the value we just emitted.
let committedThisSession = false
const displayState = computed(() => resolveEditableCellDisplay(props.modelValue, {
  formatter: props.format,
  placeholder: props.placeholder,
  emptyText: props.emptyText,
}))

const beginEdit = () => {
  if (props.readonly) return
  sessionStartValue.value = props.modelValue
  draft.value = editableCellDraftFromValue(props.modelValue)
  committedThisSession = false
  editing.value = true
}

/** Convert the local draft string into the value we emit. */
const parseDraft = (raw: string): CellValue => parseEditableCellDraft(raw, {
  type: props.type,
  currentValue: props.modelValue,
  min: props.min,
  max: props.max,
})

const applyDraft = (emitCommit = false) => {
  const next = parseDraft(draft.value)
  if (next !== props.modelValue) emit('update:modelValue', next)
  if (emitCommit) emit('commit', next)
}

const commit = () => {
  if (committedThisSession) {
    editing.value = false
    return
  }
  committedThisSession = true
  applyDraft(true)
  editing.value = false
}

const cancel = () => {
  committedThisSession = true
  if (props.commitOnInput && props.modelValue !== sessionStartValue.value) {
    emit('update:modelValue', sessionStartValue.value)
  }
  editing.value = false
}

const onEditorInput = () => {
  if (props.commitOnInput) applyDraft()
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
      'editable-cell--empty': displayState.empty,
      'editable-cell--multiline': multiline,
    }"
    @click="!editing && beginEdit()"
  >
    <EditableCellDisplay
      v-if="!editing"
      :value="modelValue"
      :state="displayState"
      :placeholder="placeholder"
      :empty-text="emptyText"
    >
      <template v-if="$slots.display" #display="slotProps">
        <slot name="display" v-bind="slotProps" />
      </template>
    </EditableCellDisplay>

    <template v-else>
      <EditableCellEditor
        v-model:draft="draft"
        :type="type"
        :placeholder="placeholder"
        :options="options"
        :min="min"
        :max="max"
        @input="onEditorInput"
        @commit="commit"
        @cancel="cancel"
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
</style>
