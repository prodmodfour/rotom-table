<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { textValueFromEvent } from '~/utils/domEvents'
import {
  resolveEditableCellOptions,
  type EditableCellOption,
  type EditableCellType,
} from '~/utils/editableCell'

const draft = defineModel<string>('draft', { required: true })

const props = withDefaults(defineProps<{
  type: EditableCellType
  placeholder?: string
  options?: readonly (string | EditableCellOption)[]
  allowEmptyOption?: boolean
  min?: number
  max?: number
  accessibleLabel?: string
}>(), {
  placeholder: '',
  options: () => [],
  allowEmptyOption: true,
  min: undefined,
  max: undefined,
  accessibleLabel: undefined,
})

type EditableCellCommitSource = 'blur' | 'change' | 'keyboard'

const emit = defineEmits<{
  (e: 'input'): void
  (e: 'commit', source: EditableCellCommitSource): void
  (e: 'cancel', source: 'keyboard'): void
}>()

const inputEl = ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)
const suggestionsListId = useId()

const optionsResolved = computed(() => resolveEditableCellOptions(props.options))
const textSuggestionListId = computed(() => (
  props.type === 'text' && optionsResolved.value.length > 0 ? suggestionsListId : undefined
))

const focusInput = async () => {
  await nextTick()
  const el = inputEl.value
  if (!el) return

  el.focus()
  if ('select' in el && typeof (el as HTMLInputElement).select === 'function') {
    ;(el as HTMLInputElement).select()
  }
}

const updateDraftFromEvent = (event: Event) => {
  draft.value = textValueFromEvent(event)
}

const commitSelectFromEvent = (event: Event) => {
  updateDraftFromEvent(event)
  emit('commit', 'change')
}

const commitSelectFromBlur = (event: Event) => {
  updateDraftFromEvent(event)
  emit('commit', 'blur')
}

const onInput = (event: Event) => {
  updateDraftFromEvent(event)
  emit('input')
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel', 'keyboard')
    return
  }

  if (event.key === 'Enter' && props.type !== 'textarea') {
    event.preventDefault()
    emit('commit', 'keyboard')
    return
  }

  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && props.type === 'textarea') {
    event.preventDefault()
    emit('commit', 'keyboard')
  }
}

onMounted(focusInput)

defineExpose({ focusInput })
</script>

<template>
  <select
    v-if="type === 'select'"
    ref="inputEl"
    :value="draft"
    class="editable-cell__input editable-cell__input--select"
    :aria-label="accessibleLabel"
    @change="commitSelectFromEvent"
    @blur="commitSelectFromBlur"
    @keydown="onKeydown"
  >
    <option v-if="allowEmptyOption" value="">{{ placeholder || '—' }}</option>
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
    :aria-label="accessibleLabel"
    @input="onInput"
    @blur="emit('commit', 'blur')"
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
    :list="textSuggestionListId"
    :aria-label="accessibleLabel"
    autocomplete="off"
    class="editable-cell__input"
    @input="onInput"
    @blur="emit('commit', 'blur')"
    @keydown="onKeydown"
  />
  <datalist v-if="textSuggestionListId" :id="textSuggestionListId">
    <option
      v-for="opt in optionsResolved"
      :key="opt.value"
      :value="opt.value"
      :label="opt.label"
    />
  </datalist>
</template>

<style scoped>
.editable-cell__input {
  min-height: 2.75rem;
  font: inherit;
  color: inherit;
  width: 100%;
  min-width: 4em;
  border: 1px solid var(--accent, #ff1f2d);
  border-radius: 4px;
  background: var(--paper, #fff);
  padding: 0.1em 0.35em;
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.18);
}

.editable-cell__input:focus-visible {
  border-color: var(--rt-focus, var(--accent));
  outline: 2px solid var(--rt-focus, var(--accent));
  outline-offset: 2px;
  box-shadow: none;
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
