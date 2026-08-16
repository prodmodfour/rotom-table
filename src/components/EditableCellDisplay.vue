<script setup lang="ts">
import type {
  EditableCellDisplayState,
  EditableCellValue,
} from '~/utils/editableCell'

const props = defineProps<{
  value: EditableCellValue
  state: EditableCellDisplayState
  placeholder: string
  emptyText: string
}>()

defineSlots<{
  display?: (props: {
    value: EditableCellValue
    displayValue: string
    empty: boolean
    placeholder: string
    emptyText: string
    emptyLabel: string
  }) => unknown
}>()
</script>

<template>
  <slot
    name="display"
    :value="props.value"
    :display-value="props.state.displayValue"
    :empty="props.state.empty"
    :placeholder="props.placeholder"
    :empty-text="props.emptyText"
    :empty-label="props.state.emptyLabel"
  >
    <span v-if="props.state.showEmptyFallback" class="editable-cell__empty">
      {{ props.state.emptyLabel }}
    </span>
    <span v-else class="editable-cell__display">{{ props.state.displayValue }}</span>
  </slot>
</template>

<style scoped>
.editable-cell__empty {
  color: var(--ink-muted, #999);
  font-style: italic;
}

.editable-cell__display {
  color: inherit;
}
</style>
