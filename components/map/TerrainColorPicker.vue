<script setup lang="ts">
defineProps<{
  colorPickerValue: string
  hasCustomColor: boolean
}>()

const emit = defineEmits<{
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
}>()
</script>

<template>
  <div class="color-row">
    <label class="color-picker">
      <span>Custom color</span>
      <input
        type="color"
        :value="colorPickerValue"
        @input="emit('color-input', $event)"
      />
    </label>
    <button
      v-if="hasCustomColor"
      type="button"
      class="ghost-button"
      @click="emit('clear-custom-color')"
    >
      Reset
    </button>
  </div>
</template>

<style scoped>
.color-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.color-picker {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.color-picker span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.color-picker input[type='color'] {
  width: 100%;
  height: 38px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  cursor: pointer;
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.ghost-button:hover {
  border-color: var(--rule-strong);
  color: var(--ink-bright);
}
</style>
