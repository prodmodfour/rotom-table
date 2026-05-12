<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <label class="ctx-label">
    {{ label }}
    <slot />
  </label>
</template>

<style scoped>
.ctx-label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-label :deep(.ctx-input) {
  font: inherit;
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  outline: none;
}

.ctx-label :deep(.ctx-input:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}
</style>
