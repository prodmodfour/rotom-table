<script setup lang="ts">
defineProps<{
  step: number
  canContinue: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'back'): void
  (event: 'next'): void
  (event: 'apply'): void
}>()
</script>

<template>
  <footer class="move-automation__footer">
    <button type="button" class="move-automation__button move-automation__button--ghost" @click="emit('close')">
      Cancel
    </button>
    <button
      v-if="step > 0"
      type="button"
      class="move-automation__button move-automation__button--ghost"
      @click="emit('back')"
    >
      Back
    </button>
    <button
      v-if="step < 2"
      type="button"
      class="move-automation__button move-automation__button--primary"
      :disabled="!canContinue"
      @click="emit('next')"
    >
      Next
    </button>
    <button
      v-else
      type="button"
      class="move-automation__button move-automation__button--primary"
      @click="emit('apply')"
    >
      Apply transaction
    </button>
  </footer>
</template>

<style scoped>
.move-automation__footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--rule-soft);
}

.move-automation__button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  padding: 0.55rem 0.85rem;
  font-weight: 700;
}

.move-automation__button--primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--paper));
  color: var(--ink-bright);
}

.move-automation__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
