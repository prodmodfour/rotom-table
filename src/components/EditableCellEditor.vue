<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
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
  min?: number
  max?: number
}>(), {
  placeholder: '',
  options: () => [],
  min: undefined,
  max: undefined,
})

const emit = defineEmits<{
  (e: 'input'): void
  (e: 'commit'): void
  (e: 'cancel'): void
}>()

const inputEl = ref<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)

const optionsResolved = computed(() => resolveEditableCellOptions(props.options))

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

const onSelectChange = (event: Event) => {
  updateDraftFromEvent(event)
  emit('commit')
}

const onInput = (event: Event) => {
  updateDraftFromEvent(event)
  emit('input')
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }

  if (event.key === 'Enter' && props.type !== 'textarea') {
    event.preventDefault()
    emit('commit')
    return
  }

  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && props.type === 'textarea') {
    event.preventDefault()
    emit('commit')
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
    @change="onSelectChange"
    @blur="emit('commit')"
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
    @blur="emit('commit')"
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
    @blur="emit('commit')"
    @keydown="onKeydown"
  />
</template>

<style scoped>
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
