<script setup lang="ts">
defineProps<{
  canEditMap: boolean
  fieldEffectCount: number
}>()

const emit = defineEmits<{
  (event: 'tick-durations'): void
  (event: 'clear-all'): void
}>()
</script>

<template>
  <div v-if="canEditMap" class="field-effect-actions">
    <button
      type="button"
      class="bulk-button"
      :disabled="!fieldEffectCount"
      @click="emit('tick-durations')"
    >
      Advance durations
    </button>
    <button
      type="button"
      class="bulk-button bulk-button--danger"
      :disabled="!fieldEffectCount"
      @click="emit('clear-all')"
    >
      Clear effects
    </button>
  </div>
</template>

<style scoped>
.field-effect-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.85rem;
}

.bulk-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.bulk-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.bulk-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bulk-button--danger {
  color: var(--bad);
}

.bulk-button--danger:hover:not(:disabled) {
  border-color: var(--bad);
  background: rgba(255, 31, 45, 0.08);
}
</style>
