<script setup lang="ts">
withDefaults(defineProps<{
  busy: boolean
  submitLabel: string
  submitVariant?: 'primary' | 'danger'
  submitDisabled?: boolean
  cancelLabel?: string
}>(), {
  submitVariant: 'primary',
  submitDisabled: false,
  cancelLabel: 'Cancel',
})

const emit = defineEmits<{
  close: []
  submit: []
}>()
</script>

<template>
  <div class="ctx-actions">
    <button type="button" class="ctx-btn" :disabled="busy" @click="emit('close')">
      {{ cancelLabel }}
    </button>
    <button
      type="button"
      class="ctx-btn"
      :class="`ctx-btn--${submitVariant}`"
      :disabled="busy || submitDisabled"
      @click="emit('submit')"
    >
      {{ submitLabel }}
    </button>
  </div>
</template>

<style scoped>
.ctx-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.ctx-btn {
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.45rem 0.85rem;
  font: inherit;
  cursor: pointer;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.ctx-btn:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.ctx-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctx-btn--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.ctx-btn--danger {
  border-color: rgba(220, 80, 80, 0.6);
  color: #d36464;
}

.ctx-btn--danger:hover:not(:disabled) {
  background: rgba(220, 80, 80, 0.16);
  color: #f08585;
}
</style>
