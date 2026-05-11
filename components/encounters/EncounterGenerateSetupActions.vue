<script setup lang="ts">
const preview = defineModel<boolean>('preview', { required: true })

defineProps<{
  hasSelectedTable: boolean
  generating: boolean
}>()

const emit = defineEmits<{
  (event: 'roll-preview'): void
  (event: 'generate'): void
}>()
</script>

<template>
  <div class="form-actions">
    <label class="checkbox-field">
      <input v-model="preview" type="checkbox" :disabled="generating" />
      <span>Preview only — write to a tempdir, stream contents back, discard.</span>
    </label>

    <div class="button-row">
      <button
        type="button"
        class="ghost-button"
        :disabled="!hasSelectedTable || generating"
        @click="emit('roll-preview')"
      >
        Re-roll preview
      </button>
      <button
        type="button"
        class="primary-button"
        :disabled="!hasSelectedTable || generating"
        @click="emit('generate')"
      >
        {{ generating ? 'Generating…' : preview ? 'Preview generation' : 'Generate folder' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.form-actions {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.checkbox-field {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.85rem;
  color: var(--ink-soft);
  line-height: 1.4;
}

.checkbox-field input {
  width: auto;
  margin-top: 0.2rem;
  accent-color: var(--accent);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.primary-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.55rem 1rem;
  border-radius: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.primary-button {
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.primary-button:hover:not(:disabled) {
  background: rgba(250, 189, 47, 0.22);
  color: var(--ink-bright);
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--ink);
}

.ghost-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.primary-button:disabled,
.ghost-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .button-row {
    justify-content: stretch;
  }

  .button-row .primary-button,
  .button-row .ghost-button {
    flex: 1;
  }
}
</style>
