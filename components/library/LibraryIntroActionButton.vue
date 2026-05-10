<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary'
}>(), {
  disabled: false,
  type: 'button',
  variant: 'secondary',
})
</script>

<template>
  <button
    v-bind="$attrs"
    :type="type"
    :disabled="disabled"
    :class="['library-intro-action-button', `library-intro-action-button--${variant}`]"
  >
    <slot />
  </button>
</template>

<style scoped>
.library-intro-action-button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.library-intro-action-button--primary {
  border-color: var(--accent);
  color: var(--accent);
}

.library-intro-action-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.library-intro-action-button--primary:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.library-intro-action-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.library-intro-action-button:disabled {
  opacity: 0.6;
  cursor: progress;
}
</style>
