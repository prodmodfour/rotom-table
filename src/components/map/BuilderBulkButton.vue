<script setup lang="ts">
const props = withDefaults(defineProps<{
  disabled?: boolean
  variant?: 'default' | 'danger'
}>(), {
  disabled: false,
  variant: 'default',
})

const emit = defineEmits<{
  (event: 'click'): void
}>()
</script>

<template>
  <button
    type="button"
    class="bulk-button"
    :class="{ 'bulk-button--danger': props.variant === 'danger' }"
    :disabled="props.disabled"
    @click="emit('click')"
  >
    <slot />
  </button>
</template>

<style scoped>
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
  color: #fb4934;
}

.bulk-button--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}
</style>
